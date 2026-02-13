/**
 * Screeps RCL5 专用代码 - 动态source分配（任务完成后调整）+ 负载均衡 + 调整冷却
 * 核心优化：1. 任务完成后才重新分配source；2. 增加调整冷却，避免频繁切换；3. 保留负载均衡+距离优先
 * 新增优化：3个Link智能互通有无，按优先级调度能量传输
 */

// ===================== 通用工具类 =====================
var ToolUtil = {
    isTargetValid: function(target) {
        return target && target.id && !target.destroyed && !target.dead;
    },

    sayWithDuration: function(creep, textList) {
        var texts = Array.isArray(textList) ? textList : [textList];
        var randomText = texts[Math.floor(Math.random() * texts.length)];
        var lastSayTick = creep.memory.lastSayTick || 0;
        if (Game.time - lastSayTick > 2) {
            creep.say(randomText);
            creep.memory.lastSayTick = Game.time;
        }
    },

    getMoveOpts: function(reusePath) {
        return {
            reusePath: reusePath || 50,
            preferRoads: true,
            avoidCreeps: true,
            serializeMemory: false
        };
    },

    doAction: function(creep, target, action, color, sayTextList, reusePath) {
        if (!this.isTargetValid(target)) return false;
        this.sayWithDuration(creep, sayTextList);
        var err = action.call(creep, target, RESOURCE_ENERGY);
        if (err === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, this.getMoveOpts(reusePath));
        }
        return err === OK;
    },

    // 核心重构：任务完成后才重新分配source + 调整冷却
    assignSource: function(creep, room) {
        // 配置项：调整冷却时间（tick），避免频繁切换
        const SOURCE_CHANGE_COOLDOWN = 50;
        // 任务完成判定：采集态creep能量满 / 目标source失效 / 冷却到期
        const isTaskCompleted = () => {
            // 1. 当前source无效（被摧毁/不存在）
            if (creep.memory.currentSourceTaskId) {
                const currentSource = Game.getObjectById(creep.memory.currentSourceTaskId);
                if (!this.isTargetValid(currentSource)) return true;
            }
            // 2. 采集态creep能量已满（完成采集任务）
            if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return true;
            // 3. 强制冷却到期（防止极端情况一直卡任务）
            if (creep.memory.sourceChangeCooldown && Game.time > creep.memory.sourceChangeCooldown) return true;
            // 任务未完成
            return false;
        };

        // 1. 实时获取房间内所有有效source
        var allSources = room.find(FIND_SOURCES, {
            filter: s => this.isTargetValid(s)
        });
        if (allSources.length === 0) return null;

        // 2. 如果任务未完成且当前source有效，继续使用当前source
        if (!isTaskCompleted() && creep.memory.currentSourceTaskId) {
            const currentSource = Game.getObjectById(creep.memory.currentSourceTaskId);
            if (this.isTargetValid(currentSource) && allSources.some(s => s.id === currentSource.id)) {
                // 输出保持当前任务的日志（简化版，避免刷屏）
                if (Game.time % 10 === 0) {
                    console.log(`[${creep.name}] 继续执行当前采集任务：[${currentSource.pos.x},${currentSource.pos.y}]`);
                }
                return currentSource;
            }
        }

        // 3. 任务完成/冷却到期，重新分配source（负载均衡+距离优先）
        // 3.1 实时统计每个source的当前采集者数量
        var sourceLoad = {};
        allSources.forEach(s => {
            sourceLoad[s.id] = {
                count: 0,
                source: s,
                distance: creep.pos.getRangeTo(s)
            };
        });

        // 3.2 统计实际负载（仅计入正在采集且任务未完成的creep）
        var harvesterRoles = ['harvester', 'upgrader'];
        var allGatherers = room.find(FIND_MY_CREEPS, {
            filter: c => harvesterRoles.includes(c.memory.role) && this.isTargetValid(c)
        });
        allGatherers.forEach(gatherer => {
            if (gatherer.memory.currentSourceTaskId && sourceLoad[gatherer.memory.currentSourceTaskId]) {
                if (gatherer.pos.getRangeTo(sourceLoad[gatherer.memory.currentSourceTaskId].source) <= 1) {
                    sourceLoad[gatherer.memory.currentSourceTaskId].count++;
                }
            }
        });

        // 3.3 排序：负载最少 → 距离最近
        var sortedSources = Object.values(sourceLoad).sort((a, b) => {
            if (a.count !== b.count) return a.count - b.count;
            return a.distance - b.distance;
        });

        // 3.4 选择最优source并设置任务状态
        var bestSource = sortedSources[0].source;
        creep.memory.currentSourceTaskId = bestSource.id; // 绑定当前任务source
        creep.memory.sourceChangeCooldown = Game.time + SOURCE_CHANGE_COOLDOWN; // 设置调整冷却

        // 调试日志
        var loadLog = allSources.map(s => 
            `[${s.pos.x},${s.pos.y}](${sourceLoad[s.id].count}人, 距离${sourceLoad[s.id].distance})`
        ).join(' | ');
        console.log(`[${creep.name}] 任务完成，重新分配source：[${bestSource.pos.x},${bestSource.pos.y}] | 各资源点负载：${loadLog}`);

        return bestSource;
    },

    getNearContainer: function(pos, hasEnergy) {
        var filter = hasEnergy ? 
            function(s) { return s.structureType === STRUCTURE_CONTAINER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0; } :
            function(s) { return s.structureType === STRUCTURE_CONTAINER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0; };
        return pos.findClosestByPath(FIND_STRUCTURES, { filter: filter, limit: 1 });
    },

    getBodyCost: function(body) {
        var costMap = { WORK: 100, CARRY: 50, MOVE: 50, ATTACK: 80, TOUGH: 10 };
        var sum = 0;
        for (var i = 0; i < body.length; i++) {
            sum += costMap[body[i]] || 0;
        }
        return sum;
    },

    getEnergyForTransporter: function(creep, reusePath) {
        var room = creep.room;
        var spawnLink = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK && s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0,
            limit: 1
        })[0];
        
        if (spawnLink && this.doAction(creep, spawnLink, creep.withdraw, '#00ffcc', ['🔄从L取能'], reusePath)) return;
        
        var container = this.getNearContainer(creep.pos, true);
        if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            if (this.doAction(creep, container, creep.withdraw, '#ffaa00', ['🔄从C取能'], reusePath)) return;
        }
        
        var storage = room.storage;
        if (storage) this.doAction(creep, storage, creep.withdraw, '#ffff00', ['🔄从S取能'], reusePath);
    },

    getEnergyForUpgraderAndBuilder: function(creep, reusePath) {
        var room = creep.room;
        
        // upgrader：优先从container取能，其次动态采集source（任务完成后调整）
        if (creep.memory.role === 'upgrader') {
            var container = this.getNearContainer(creep.pos, true);
            if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                if (this.doAction(creep, container, creep.withdraw, '#ffaa00', ['🔄从C取能'], reusePath)) {
                    // 取能成功，重置source任务（因为不需要采集了）
                    delete creep.memory.currentSourceTaskId;
                    return;
                }
            }
            // 无container，采集source（任务完成后调整）
            var source = this.assignSource(creep, room);
            if (source) this.doAction(creep, source, creep.harvest, '#66ff66', ['⛏️自行采集能源'], reusePath);
            return;
        }

        // builder逻辑保持不变
        if (creep.memory.role === 'builder') {
            var spawnLink = room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_LINK && s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0,
                limit: 1
            })[0];
            if (spawnLink && this.doAction(creep, spawnLink, creep.withdraw, '#66ff66', ['🔄从L取能'], reusePath)) return;
            
            var storage = room.storage;
            if (storage && this.doAction(creep, storage, creep.withdraw, '#ffff00', ['🔄从S取能'], reusePath)) return;
            
            var container = this.getNearContainer(creep.pos, true);
            if (container && this.doAction(creep, container, creep.withdraw, '#ffaa00', ['🔄从C取能'], reusePath)) return;
        }
    },

    refillCoreForTransporter: function(creep, reusePath) {
        var room = creep.room;
        var coreStructures = room.find(FIND_MY_STRUCTURES, {
            filter: function(s) {
                return (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) 
                    && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });
        if (coreStructures.length > 0) {
            this.doAction(creep, coreStructures[0], creep.transfer, '#66ff66', ['⚡运输能源'], reusePath);
            return;
        }
        var tower = room.find(FIND_MY_STRUCTURES, {
            filter: function(s) {
                return s.structureType === STRUCTURE_TOWER 
                && s.store.getFreeCapacity(RESOURCE_ENERGY) > 100;
            }
        });
        if (tower.length > 0) {
            this.doAction(creep, tower[0], creep.transfer, '#ff0000', ['⚡补充T能量'], reusePath);
            return;
        }
        var storage = room.storage;
        if (storage && this.doAction(creep, storage, creep.transfer, '#ffff00', ['⚡向S储能'], reusePath)) return;
        this.sayWithDuration(creep, ['⚡闲置']);
    },

    upgradeCtrl: function(creep, reusePath) {
        var ctrl = creep.room.controller;
        if (!this.isTargetValid(ctrl)) return;
        this.sayWithDuration(creep, ['⚡升级控制器','⚡升职加薪啦']);
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
            creep.moveTo(ctrl, this.getMoveOpts(reusePath));
        }
    },

    checkStuckAndClearPath: function(creep) {
        if (!creep.memory.lastPos) {
            creep.memory.lastPos = {x: creep.pos.x, y: creep.pos.y, tick: Game.time};
            return false;
        }
        var lastPos = creep.memory.lastPos;
        if (lastPos.x === creep.pos.x && lastPos.y === creep.pos.y) {
            if (Game.time - lastPos.tick >= 999) {
                delete creep.memory._move;
                creep.memory.lastPos = {x: creep.pos.x, y: creep.pos.y, tick: Game.time};
                this.sayWithDuration(creep, ['🚨缓解卡顿','🚨清理缓存']);
                console.log('['+creep.name+'] 卡住999tick，已清理寻路缓存');
                return true;
            }
        } else {
            creep.memory.lastPos = {x: creep.pos.x, y: creep.pos.y, tick: Game.time};
        }
        return false;
    },

    clearAllCreepPathCache: function() {
        var count = 0;
        for (var name in Game.creeps) {
            var creep = Game.creeps[name];
            if (creep && creep.memory._move) {
                delete creep.memory._move;
                count++;
            }
        }
        console.log('['+Game.time+'] 批量清理'+count+'个Creep寻路缓存');
    }
};

// ===================== 造兵管理器 =====================
var SpawnManager = {
    BODIES: {
        harvester: [WORK,WORK,WORK,WORK,CARRY,CARRY,MOVE,MOVE],
        transporter: [CARRY,CARRY,CARRY,CARRY,MOVE,MOVE],
        upgrader: [WORK,WORK,WORK,CARRY,CARRY,MOVE,MOVE,MOVE], 
        builder: [WORK,WORK,CARRY,CARRY,CARRY,MOVE,MOVE],
        defender: [ATTACK,ATTACK,TOUGH,TOUGH,MOVE,MOVE]
    },
    CREEP_NUM: { harvester: 4, transporter: 1, upgrader: 2, builder: 1, defender: 0 },
    PRIORITY: ['harvester', 'transporter', 'upgrader', 'builder', 'defender'],
    BODY_COST: {},

    init: function() {
        for (var role in this.BODIES) {
            this.BODY_COST[role] = ToolUtil.getBodyCost(this.BODIES[role]);
        }
    },

    run: function(room) {
        if (Object.keys(this.BODY_COST).length === 0) this.init();

        var spawn = room.find(FIND_MY_SPAWNS, {limit:1})[0];
        if (!ToolUtil.isTargetValid(spawn) || spawn.spawning) return;

        // 实时统计creep数量
        var creepCount = {harvester:0, transporter:0, upgrader:0, builder:0, defender:0};
        room.find(FIND_MY_CREEPS).forEach(c => {
            if (creepCount[c.memory.role] !== undefined) creepCount[c.memory.role]++;
        });

        var currentEnergy = room.energyAvailable;

        for (var i = 0; i < this.PRIORITY.length; i++) {
            var role = this.PRIORITY[i];
            if (creepCount[role] >= this.CREEP_NUM[role]) continue;

            var fullCost = this.BODY_COST[role];
            var body = currentEnergy >= fullCost ? this.BODIES[role] : [WORK,CARRY,MOVE];

            var name = role + '_' + Game.time;
            var result = spawn.spawnCreep(body, name, {
                memory: { 
                    role: role, 
                    working: false, 
                    room: room.name,
                    currentSourceTaskId: null, // 初始化source任务ID
                    sourceChangeCooldown: 0 // 初始化调整冷却
                }
            });
            
            if (result === OK) {
                console.log(`[${room.name}] 孵化爬爬：${name} | 角色：${role} | 身体：[${body.join(',')}]`);
                return;
            }
        }
    }
};

// ===================== Creep逻辑 =====================
var CreepLogic = {
    COLOR: { harvester: '#ffaa00', transporter: '#00ffcc', upgrader: '#66ff66', builder: '#ffff00', defender: '#ff0000' },

    run: function(room) {
        // 实时遍历所有creep
        var allCreeps = room.find(FIND_MY_CREEPS);
        allCreeps.forEach(creep => {
            if (!ToolUtil.isTargetValid(creep)) return;
            ToolUtil.checkStuckAndClearPath(creep);
            this.switchState(creep);
            if (this[creep.memory.role]) {
                this[creep.memory.role](creep);
            }
        });
    },

    switchState: function(creep) {
        var used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
        var free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
        
        if (used === 0) {
            creep.memory.working = false;
            delete creep.memory._move;
            // 能量空了，重置任务状态（可以重新分配source）
            // 注意：不删除currentSourceTaskId，让assignSource判定是否需要重新分配
        } else if (free === 0) {
            creep.memory.working = true;
            delete creep.memory._move;
            // 能量满了，标记任务完成（但保留currentSourceTaskId，等下次采集时判定）
        }

        if (creep.memory.working && used === 0) {
            creep.memory.working = false;
            delete creep.memory._move;
            ToolUtil.sayWithDuration(creep, ['🔄取出能源']);
        } else if (!creep.memory.working && free === 0) {
            creep.memory.working = true;
            delete creep.memory._move;
            ToolUtil.sayWithDuration(creep, ['⚡好好工作','干掉上面']);
        }
    },

    harvester: function(creep) {
        var room = creep.room;
        var source = ToolUtil.assignSource(creep, room);

        if (!source) {
            ToolUtil.sayWithDuration(creep, ['❌无资源点']);
            return;
        }

        if (!creep.memory.working) {
            // 采集态：任务完成前不切换source
            ToolUtil.doAction(creep, source, creep.harvest, this.COLOR.harvester, ['⛏️采集能源'], 50);
            return;
        }

        // 能量满了，执行存储逻辑（完成采集任务）
        // 优先级1：Spawn和Extension
        var coreStructures = room.find(FIND_MY_STRUCTURES, {
            filter: function(s) {
                return (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) 
                    && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            },
            limit: 1
        })[0];
        if (ToolUtil.isTargetValid(coreStructures)) {
            ToolUtil.doAction(creep, coreStructures, creep.transfer, this.COLOR.harvester, ['🏭存入核心设施'], 50);
            return;
        }
        
        // 优先级2：Source附近的Link
        var sourceLink = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK && s.pos.getRangeTo(source) <= 3,
            limit: 1
        })[0];
        if (ToolUtil.isTargetValid(sourceLink) && sourceLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            ToolUtil.doAction(creep, sourceLink, creep.transfer, this.COLOR.harvester, ['🔗存入L'], 50);
            return;
        }
        
        // 优先级3：Source附近的Container
        var container = ToolUtil.getNearContainer(source.pos, false);
        if (ToolUtil.isTargetValid(container) && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            ToolUtil.doAction(creep, container, creep.transfer, this.COLOR.harvester, ['📦存入C'], 50);
            return;
        }
        
        // 优先级4：Storage
        var storage = room.storage;
        if (ToolUtil.isTargetValid(storage) && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            ToolUtil.doAction(creep, storage, creep.transfer, this.COLOR.harvester, ['🗄️存入S'], 50);
            return;
        }

        ToolUtil.sayWithDuration(creep, ['📥已满，加班去']);
        creep.memory.working = false;
        delete creep.memory._move;
    },

    transporter: function(creep) {
        if (!creep.memory.working) {
            ToolUtil.getEnergyForTransporter(creep, 20);
            return;
        }
        ToolUtil.refillCoreForTransporter(creep, 20);
    },

    upgrader: function(creep) {
        if (!creep.memory.working) {
            ToolUtil.getEnergyForUpgraderAndBuilder(creep, 50);
            return;
        }
        ToolUtil.upgradeCtrl(creep, 50);
    },

    builder: function(creep) {
        var room = creep.room;
        if (!creep.memory.working) {
            ToolUtil.getEnergyForUpgraderAndBuilder(creep, 20);
            return;
        }

        // 优先级1：核心建筑建造
        var coreSite = room.find(FIND_CONSTRUCTION_SITES, {
            filter: function(s) {
                return [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_STORAGE, STRUCTURE_LINK].includes(s.structureType);
            },
            limit: 1
        });
        if (coreSite.length > 0) {
            ToolUtil.doAction(creep, coreSite[0], creep.build, this.COLOR.builder, ['🔨建造核心设施'], 20);
            return;
        }
        
        // 优先级2：普通建筑建造
        var allSite = room.find(FIND_CONSTRUCTION_SITES, { limit: 1 });
        if (allSite.length > 0) {
            ToolUtil.doAction(creep, allSite[0], creep.build, this.COLOR.builder, ['🔨建造普通建筑'], 20);
            return;
        }
        
        // 优先级3：核心设施维修
        var coreRepair = room.find(FIND_STRUCTURES, {
            filter: function(s) { return [STRUCTURE_SPAWN,STRUCTURE_LINK,STRUCTURE_TOWER,STRUCTURE_STORAGE].includes(s.structureType) && s.hits < s.hitsMax * 0.8; },
            limit: 1
        });
        if (coreRepair.length > 0) {
            ToolUtil.doAction(creep, coreRepair[0], creep.repair, this.COLOR.builder, ['🔧维护核心设施'], 20);
            return;
        }
        
        // 优先级4：基建维修
        var civilRepair = room.find(FIND_STRUCTURES, {
            filter: function(s) { return [STRUCTURE_CONTAINER,STRUCTURE_ROAD].includes(s.structureType) && s.hits < s.hitsMax * 0.5; },
            limit: 1
        });
        if (civilRepair.length > 0) {
            ToolUtil.doAction(creep, civilRepair[0], creep.repair, this.COLOR.builder, ['🔧维修普通建筑'], 20);
            return;
        }
        
        // 优先级5：防御设施维修
        var defRepair = room.find(FIND_STRUCTURES, {
            filter: function(s) { return [STRUCTURE_WALL,STRUCTURE_RAMPART].includes(s.structureType) && s.hits < 100000; },
            limit: 1
        });
        if (defRepair.length > 0) {
            ToolUtil.doAction(creep, defRepair[0], creep.repair, this.COLOR.builder, ['🔧维修防御设施'], 20);
            return;
        }
        
        // 兜底：升级控制器
        ToolUtil.upgradeCtrl(creep, 20);
    },

    defender: function(creep) {
        var room = creep.room;
        var enemy = room.find(FIND_HOSTILE_CREEPS, { limit: 1 })[0];
        if (enemy) {
            ToolUtil.doAction(creep, enemy, creep.attack, this.COLOR.defender, ['⚔️防御启动'], 20);
        } else {
            var patrolTarget = Game.time % 100 < 50 ? room.find(FIND_MY_SPAWNS, {limit:1})[0] : room.controller;
            if (patrolTarget) creep.moveTo(patrolTarget, ToolUtil.getMoveOpts(20));
            ToolUtil.sayWithDuration(creep, ['🛡️巡逻中']);
        }
    }
};

// ===================== Tower管理器 =====================
var TowerManager = {
    MIN_ENERGY: 200,
    run: function(room) {
        if (Game.time % 5 !== 0) return;
        var towers = room.find(FIND_MY_STRUCTURES, { filter: { structureType: STRUCTURE_TOWER }, limit: 2 });
        if (towers.length === 0) return;

        var enemy = room.find(FIND_HOSTILE_CREEPS, { limit: 1 })[0];
        if (enemy) {
            towers.forEach((tower, idx) => {
                if (tower.store.getUsedCapacity(RESOURCE_ENERGY) >= 10) {
                    tower.attack(enemy);
                    console.log(`[${room.name}] Tower${idx+1}攻击敌人：${enemy.name || enemy.id}`);
                }
            });
            return;
        }

        towers.forEach(tower => {
            if (tower.store.getUsedCapacity(RESOURCE_ENERGY) <= this.MIN_ENERGY) return;

            var coreTarget = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return [STRUCTURE_SPAWN, STRUCTURE_LINK, STRUCTURE_STORAGE, STRUCTURE_TOWER].includes(s.structureType) 
                        && s.hits < s.hitsMax * 0.8;
                },
                limit: 1
            })[0];
            if (coreTarget) { tower.repair(coreTarget); return; }

            var civilTarget = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return [STRUCTURE_CONTAINER, STRUCTURE_ROAD].includes(s.structureType) 
                    && s.hits < s.hitsMax * 0.5;
                },
                limit: 1
            })[0];
            if (civilTarget) { tower.repair(civilTarget); return; }

            var defTarget = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return [STRUCTURE_WALL, STRUCTURE_RAMPART].includes(s.structureType) 
                    && s.hits < 100000;
                },
                limit: 1
            })[0];
            if (defTarget) tower.repair(defTarget);
        });
    }
};

// ===================== Link管理器（3个Link互通有无）=====================
var LinkManager = {
    // 配置项：Link传输阈值
    SEND_THRESHOLD: 800,    // 超过此值需要发送能量
    RECEIVE_THRESHOLD: 200, // 低于此值需要接收能量
    MIN_TRANSFER: 100,      // 最小传输量，避免小额无效传输
    
    run: function(room) {
        if (Game.time % 10 !== 0) return;
        
        // 1. 动态查找所有Link并分类
        var allLinks = room.find(FIND_MY_STRUCTURES, { filter: { structureType: STRUCTURE_LINK } });
        if (allLinks.length < 3) {
            console.log(`[${room.name}] Link数量不足3个，跳过Link调度`);
            return;
        }
        
        // 识别三个Link的角色
        var sourceLink = allLinks.find(link => link.pos.findInRange(FIND_SOURCES, 3).length > 0);
        var controllerLink = allLinks.find(link => link.pos.findInRange(FIND_MY_CONTROLLERS, 3).length > 0);
        var spawnLink = allLinks.find(link => link.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0);
        
        // 校验所有Link都存在
        if (!sourceLink || !controllerLink || !spawnLink) {
            console.log(`[${room.name}] 无法识别全部3个Link角色，跳过调度`);
            return;
        }

        // 2. 定义辅助函数：执行Link传输
        const transferEnergy = (sender, receiver, minFree = this.MIN_TRANSFER) => {
            // 校验条件：发送方有能量、接收方有空间、发送方无冷却
            if (sender.cooldown !== 0) return false;
            const senderEnergy = sender.store.getUsedCapacity(RESOURCE_ENERGY);
            const receiverFree = receiver.store.getFreeCapacity(RESOURCE_ENERGY);
            
            if (senderEnergy < this.MIN_TRANSFER || receiverFree < minFree) return false;
            
            // 计算可传输的最大量（不超过接收方剩余空间，不超过发送方可用能量）
            const transferAmount = Math.min(senderEnergy, receiverFree);
            sender.transferEnergy(receiver, transferAmount);
            console.log(`[${room.name}] Link传输：${sender.pos} → ${receiver.pos} | 数量：${transferAmount}`);
            return true;
        };

        // 3. 智能调度逻辑（优先级：核心设施 > 控制器升级 > 能量平衡）
        // 优先级1：保障SpawnLink（核心设施）的能量供应
        if (spawnLink.store.getUsedCapacity(RESOURCE_ENERGY) < this.RECEIVE_THRESHOLD) {
            // 先从SourceLink取
            if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > this.MIN_TRANSFER) {
                if (transferEnergy(sourceLink, spawnLink)) return;
            }
            // SourceLink不够，从ControllerLink取（紧急情况）
            else if (controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) > this.RECEIVE_THRESHOLD + this.MIN_TRANSFER) {
                if (transferEnergy(controllerLink, spawnLink)) return;
            }
        }

        // 优先级2：保障ControllerLink（升级）的能量供应
        if (controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) < this.RECEIVE_THRESHOLD) {
            // 先从SourceLink取
            if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > this.MIN_TRANSFER) {
                if (transferEnergy(sourceLink, controllerLink)) return;
            }
            // SourceLink不够，从SpawnLink取（SpawnLink有富余时）
            else if (spawnLink.store.getUsedCapacity(RESOURCE_ENERGY) > this.SEND_THRESHOLD) {
                if (transferEnergy(spawnLink, controllerLink)) return;
            }
        }

        // 优先级3：平衡SourceLink的富余能量（避免浪费）
        if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) >= this.SEND_THRESHOLD) {
            // 先给SpawnLink补充（未满时）
            if (spawnLink.store.getFreeCapacity(RESOURCE_ENERGY) > this.MIN_TRANSFER) {
                if (transferEnergy(sourceLink, spawnLink)) return;
            }
            // 再给ControllerLink补充（未满时）
            else if (controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) > this.MIN_TRANSFER) {
                if (transferEnergy(sourceLink, controllerLink)) return;
            }
        }

        // 优先级4：平衡SpawnLink的富余能量
        if (spawnLink.store.getUsedCapacity(RESOURCE_ENERGY) >= this.SEND_THRESHOLD) {
            // 给ControllerLink补充
            if (controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) > this.MIN_TRANSFER) {
                if (transferEnergy(spawnLink, controllerLink)) return;
            }
        }
    }
};

// ===================== 房间管理器 =====================
var RoomManager = {
    run: function(room) {
        room.memory = room.memory || {};
        room.memory.static = room.memory.static || {};
    }
};

// ===================== 主循环 =====================
module.exports.loop = function () {
    // 清理无效creep内存
    if (Game.time % 50 === 0) {
        for (var name in Memory.creeps) {
            if (!Game.creeps[name]) delete Memory.creeps[name];
        }
    }
    
    // 定期清理寻路缓存
    if (Game.time % 200 === 0) ToolUtil.clearAllCreepPathCache();
    
    // 定期重置内存
    if (Game.time % 50000 === 0) {
        for (var r in Game.rooms) {
            Game.rooms[r].memory = { static: {} };
        }
    }

    // 运行各管理器
    for (var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) continue;

        RoomManager.run(room);
        SpawnManager.run(room);
        LinkManager.run(room);
        TowerManager.run(room);
        CreepLogic.run(room);
    }
};
