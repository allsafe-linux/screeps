// ===================== 全局配置 (整合优化) =====================
var GLOBAL_CONFIG = {
    HOME_ROOM: 'W13S59',
    LAB_RECIPES: [
        {id: 'GHOUL', result: RESOURCE_GHODIUM, 'in': [RESOURCE_ZYNTHIUM, RESOURCE_ZYNTHIUM]}
    ],
    TERMINAL: {
        SELL_ZYNTHIUM_THRESHOLD: 5000,
        KEEP_ZYNTHIUM: 1000,
        MIN_PRICE: 0.5,
        MAX_SINGLE_SELL: 5000,
        KEEP_ENERGY: 50000,
        COOLDOWN_CHECK: true,
        FEE_RATIO: 0.05, // 交易手续费比例（固定5%）
        MIN_ENERGY_FOR_DEAL: 1000 // 交易所需最低终端能量（支付手续费）
    }
};

// ===================== 通用工具类 (增强版 + 补全逻辑) =====================
var ToolUtil = {
    isTargetValid: function(target) {
        return target && target.id && !target.destroyed && !target.dead;
    },

    sayWithDuration: function(creep, textList) {
        var texts = Object.prototype.toString.call(textList) === '[object Array]' ? textList : [textList];
        var randomText = texts[Math.floor(Math.random() * texts.length)];
        var lastSayTick = creep.memory.lastSayTick || 0;
        
        if (Game.time - lastSayTick > 2) {
            creep.say(randomText);
            creep.memory.lastSayTick = Game.time;
        } else if (Game.time - lastSayTick === 2) {
            creep.say('');
        }
    },

    getMoveOpts: function(reusePath) {
        return {
            reusePath: reusePath || 50,
            preferRoads: true,
            avoidCreeps: true,
            serializeMemory: false,
            visualizePathStyle: { stroke: '#ffffff', opacity: 0.7, lineStyle: 'dashed' }
        };
    },

    doAction: function(creep, target, action, color, sayTextList, reusePath, resourceType) {
        if (!this.isTargetValid(target)) return false;
        this.sayWithDuration(creep, sayTextList);
        var resType = resourceType || RESOURCE_ENERGY;
        var err = action.call(creep, target, resType);
        if (err === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, this.getMoveOpts(reusePath));
        }
        return err === OK;
    },

    assignSource: function(creep, room) {
        var SOURCE_CHANGE_COOLDOWN = 50;
        var isTaskCompleted = function() {
            if (creep.memory.currentSourceTaskId) {
                var currentSource = Game.getObjectById(creep.memory.currentSourceTaskId);
                if (!ToolUtil.isTargetValid(currentSource)) return true;
            }
            if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return true;
            if (creep.memory.sourceChangeCooldown && Game.time > creep.memory.sourceChangeCooldown) return true;
            return false;
        };

        var allSources = room.find(FIND_SOURCES, {
            filter: function(s) { return ToolUtil.isTargetValid(s); }
        });
        if (allSources.length === 0) {
            console.log('[' + creep.name + '] 房间' + room.name + '无可用矿源！');
            return null;
        }

        var currentSource = null;
        if (creep.memory.currentSourceTaskId) {
            currentSource = Game.getObjectById(creep.memory.currentSourceTaskId);
        }
        if (!isTaskCompleted() && ToolUtil.isTargetValid(currentSource)) {
            // 检查currentSource是否在allSources中
            var isInSources = false;
            for (var i = 0; i < allSources.length; i++) {
                if (allSources[i].id === currentSource.id) {
                    isInSources = true;
                    break;
                }
            }
            if (isInSources) {
                if (Game.time % 10 === 0) {
                    console.log('[' + creep.name + '] 继续采集矿源[' + currentSource.pos.x + ',' + currentSource.pos.y + ']');
                }
                return currentSource;
            }
        }

        var sourceLoad = {};
        for (var j = 0; j < allSources.length; j++) {
            var s = allSources[j];
            sourceLoad[s.id] = {
                count: 0,
                source: s,
                distance: creep.pos.getRangeTo(s)
            };
        }

        var harvesterRoles = ['harvester', 'upgrader'];
        for (var name in Game.creeps) {
            var creepIter = Game.creeps[name];
            if (creepIter.room.name === room.name && harvesterRoles.indexOf(creepIter.memory.role) !== -1 && creepIter.memory.currentSourceTaskId) {
                if (sourceLoad[creepIter.memory.currentSourceTaskId]) {
                    sourceLoad[creepIter.memory.currentSourceTaskId].count++;
                }
            }
        }

        // ES5 实现 _.min 功能
        var bestSource = allSources[0];
        var minScore = sourceLoad[bestSource.id].count * 10 + sourceLoad[bestSource.id].distance;
        for (var k = 1; k < allSources.length; k++) {
            var s = allSources[k];
            var score = sourceLoad[s.id].count * 10 + sourceLoad[s.id].distance;
            if (score < minScore) {
                minScore = score;
                bestSource = s;
            }
        }

        creep.memory.currentSourceTaskId = bestSource.id;
        creep.memory.sourceChangeCooldown = Game.time + SOURCE_CHANGE_COOLDOWN;
        console.log('[' + creep.name + '] 分配新矿源：[' + bestSource.pos.x + ',' + bestSource.pos.y + ']');
        return bestSource;
    },

    assignZynthiumMineral: function(creep, room) {
        var zMinerals = room.find(FIND_MINERALS, {
            filter: function(m) {
                return m.mineralType === RESOURCE_ZYNTHIUM && m.mineralAmount > 0;
            }
        });
        if (zMinerals.length === 0) return null;
        
        // 查找有提取器的矿物
        var hasExtractorMineral = null;
        for (var i = 0; i < zMinerals.length; i++) {
            var m = zMinerals[i];
            var structures = m.pos.lookFor(LOOK_STRUCTURES);
            for (var j = 0; j < structures.length; j++) {
                if (structures[j].structureType === STRUCTURE_EXTRACTOR) {
                    hasExtractorMineral = m;
                    break;
                }
            }
            if (hasExtractorMineral) break;
        }
        
        return hasExtractorMineral || zMinerals[0];
    },
    
    getNearbyStructures: function(pos, structureType, hasEnergy) {
        var structures = pos.findInRange(FIND_STRUCTURES, 3, {
            filter: function(s) {
                if (s.structureType !== structureType) return false;
                if (hasEnergy === undefined) return true;
                if (hasEnergy) return s.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });
        return structures.length > 0 ? structures[0] : null;
    },

    getBodyCost: function(body) {
        var costMap = { WORK: 100, CARRY: 50, MOVE: 50, ATTACK: 80, RANGED_ATTACK: 150, TOUGH: 10, CLAIM: 600 };
        var sum = 0;
        for (var i = 0; i < body.length; i++) {
            sum += costMap[body[i]] || 0;
        }
        return sum;
    },

    // 新增：计算交易手续费
    calculateDealFee: function(amount, price) {
        return Math.ceil(amount * price * GLOBAL_CONFIG.TERMINAL.FEE_RATIO);
    }
};

// ===================== 造兵管理器 =====================
var SpawnManager = {
    BODIES: {
        harvester: [WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],
        transporter: [CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE],
        upgrader: [WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE], 
        builder: [WORK,WORK,CARRY,CARRY,CARRY,MOVE,MOVE],
        defender: [RANGED_ATTACK, RANGED_ATTACK, TOUGH, TOUGH, MOVE, MOVE, MOVE],
        miner: [WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE],
        scout: [MOVE],
        attacker: [RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, TOUGH, MOVE, MOVE, MOVE]
    },
    CREEP_NUM: { 
        harvester: 2, transporter: 1, upgrader: 4, builder: 1, 
        defender: 0, miner: 0, scout: 0, attacker: 0
    },
    PRIORITY: ['harvester', 'transporter', 'upgrader', 'miner', 'builder', 'defender'],
    BODY_COST: null,
    
    init: function() {
        this.BODY_COST = {};
        for (var role in this.BODIES) {
            if (this.BODIES.hasOwnProperty(role)) {
                this.BODY_COST[role] = ToolUtil.getBodyCost(this.BODIES[role]);
            }
        }
    },

    run: function(room) {
        if (!this.BODY_COST) this.init();
        var spawns = room.find(FIND_MY_SPAWNS);
        var spawn = spawns.length > 0 ? spawns[0] : null;
        if (!spawn || spawn.spawning) return;

        // 初始化计数
        var counts = {};
        for (var r in this.CREEP_NUM) {
            if (this.CREEP_NUM.hasOwnProperty(r)) {
                counts[r] = 0;
            }
        }
        
        // 统计现有 creep 数量
        var creeps = room.find(FIND_MY_CREEPS);
        for (var i = 0; i < creeps.length; i++) {
            var c = creeps[i];
            if (counts.hasOwnProperty(c.memory.role)) {
                counts[c.memory.role]++;
            }
        }

        var zMineral = ToolUtil.assignZynthiumMineral(null, room);
        var extractor = null;
        if (zMineral) {
            var structures = zMineral.pos.lookFor(LOOK_STRUCTURES);
            for (var j = 0; j < structures.length; j++) {
                if (structures[j].structureType === STRUCTURE_EXTRACTOR) {
                    extractor = structures[j];
                    break;
                }
            }
        }
        
        if (zMineral && extractor && zMineral.mineralAmount > 0) {
            this.CREEP_NUM.miner = 1;
        } else {
            this.CREEP_NUM.miner = 0;
        }

        // 按优先级创建 creep
        for (var k = 0; k < this.PRIORITY.length; k++) {
            var role = this.PRIORITY[k];
            if (counts[role] >= this.CREEP_NUM[role]) continue;
            
            var body = room.energyAvailable >= this.BODY_COST[role] ? this.BODIES[role] : [WORK,CARRY,MOVE];
            var name = role + '_' + Game.time;
            var mem = { role: role, working: false, room: room.name };
            
            if (spawn.spawnCreep(body, name, {memory: mem}) === OK) {
                console.log('[Spawn] 孵化 ' + name);
                return;
            }
        }
    }
};

// ===================== Creep逻辑 =====================
var CreepLogic = {
    run: function(room) {
        var creeps = room.find(FIND_MY_CREEPS);
        for (var i = 0; i < creeps.length; i++) {
            var creep = creeps[i];
            if (!ToolUtil.isTargetValid(creep)) continue;
            this.switchState(creep);
            if (typeof this[creep.memory.role] === 'function') {
                this[creep.memory.role](creep);
            }
        }
    },

    switchState: function(creep) {
        var defenderRoles = ['defender', 'scout', 'attacker'];
        if (defenderRoles.indexOf(creep.memory.role) !== -1) return;
        
        var resType = creep.memory.role === 'miner' ? RESOURCE_ZYNTHIUM : RESOURCE_ENERGY;
        var used = creep.store.getUsedCapacity(resType);
        var free = creep.store.getFreeCapacity(resType);

        if (used === 0 && creep.memory.working) {
            creep.memory.working = false;
            delete creep.memory._move;
            delete creep.memory.taskTargetId;
        } else if (free === 0 && !creep.memory.working) {
            creep.memory.working = true;
            delete creep.memory._move;
            delete creep.memory.taskTargetId;
        }
    },

    harvester: function(creep) {
        var room = creep.room;
        if (!creep.memory.working) {
            var source = ToolUtil.assignSource(creep, room);
            if (!source) {
                console.log('[Harvester-' + creep.name + '] 无可用矿源！');
                return;
            }
            ToolUtil.doAction(creep, source, creep.harvest, '#ffaa00', ['采集能源'], 50, RESOURCE_ENERGY);
            return;
        }

        var source = null;
        if (creep.memory.currentSourceTaskId) {
            source = Game.getObjectById(creep.memory.currentSourceTaskId);
        }
        if (!ToolUtil.isTargetValid(source)) {
            source = ToolUtil.assignSource(creep, room);
        }

        if (source) {
            var link = ToolUtil.getNearbyStructures(source.pos, STRUCTURE_LINK, false);
            if (link && ToolUtil.doAction(creep, link, creep.transfer, '#ffaa00', ['存矿到链路'], 50)) return;
        }

        if (source) {
            var cont = ToolUtil.getNearbyStructures(source.pos, STRUCTURE_CONTAINER, false);
            if (cont && ToolUtil.doAction(creep, cont, creep.transfer, '#ffaa00', ['存矿到容器'], 50)) return;
        }

        // 寻找孵化场/扩展
        var coreStructures = room.find(FIND_STRUCTURES, {
            filter: function(s) {
                return (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) && 
                       s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });
        var core = creep.pos.findClosestByPath(coreStructures);
        if (core && ToolUtil.doAction(creep, core, creep.transfer, '#ffaa00', ['送矿到孵化'], 50)) return;

        if (room.storage && ToolUtil.doAction(creep, room.storage, creep.transfer, '#ffaa00', ['存矿到仓库'], 50)) return;
    },

    // ========== 修复语法错误后的 transporter 方法 ==========
    transporter: function(creep) {
        var room = creep.room;
        var RES_TYPE = RESOURCE_ENERGY;
        var TARGET_LOCK_TICK = 10;
        // 关键：指定spawn旁link的坐标（30,24），优先处理这个link
        var SPAWN_LINK_POS = new RoomPosition(30, 24, room.name);

        var isCachedTargetValid = function(targetId, isWithdraw) {
            if (!targetId) return false;
            var target = Game.getObjectById(targetId);
            if (!ToolUtil.isTargetValid(target)) return false;
            
            if (isWithdraw) {
                // 降低取能阈值：只要有能量就取，不再限制800
                return target.store.getUsedCapacity(RES_TYPE) > 0 && 
                       creep.store.getFreeCapacity(RES_TYPE) > 0;
            }
            return target.store.getFreeCapacity(RES_TYPE) > 0 && 
                   creep.store.getUsedCapacity(RES_TYPE) > 0;
        };

        var lockTarget = function(target, type) {
            creep.memory.taskTargetId = target.id;
            creep.memory.targetLockExpire = Game.time + TARGET_LOCK_TICK;
            creep.memory.targetType = type;
            console.log('[Transporter-' + creep.name + '] 锁定' + type + '目标：' + target.structureType + '(' + target.pos.x + ',' + target.pos.y + ')');
        };

        if (!creep.memory.working) {
            if (creep.memory.taskTargetId && creep.memory.targetType === 'withdraw' && 
                Game.time < creep.memory.targetLockExpire && 
                isCachedTargetValid(creep.memory.taskTargetId, true)) {
                var target = Game.getObjectById(creep.memory.taskTargetId);
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取能量'], 20, RES_TYPE);
                return;
            }

            delete creep.memory.taskTargetId;
            delete creep.memory.targetLockExpire;
            delete creep.memory.targetType;

            var target = null;
            
            // 优先级1：强制优先处理指定坐标的spawn旁link（30,24）【修复ES5兼容问题】
            var spawnLinkStructures = SPAWN_LINK_POS.lookFor(LOOK_STRUCTURES);
            var spawnLink = null;
            if (spawnLinkStructures.length > 0) {
                spawnLink = Game.getObjectById(spawnLinkStructures[0].id);
            }
            if (spawnLink && spawnLink.structureType === STRUCTURE_LINK && spawnLink.store.getUsedCapacity(RES_TYPE) > 0) {
                target = spawnLink;
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取Spawn链路'], 20, RES_TYPE);
                return;
            }

            // 优先级2：矿源附近的link（阈值从800降为100，更灵敏）
            var sourceLinks = room.find(FIND_MY_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_LINK && 
                           s.pos.findInRange(FIND_SOURCES, 2).length > 0 &&
                           s.store.getUsedCapacity(RES_TYPE) > 100;
                }
            });
            if (sourceLinks.length > 0) {
                target = sourceLinks[0];
            }
            
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取链路能量'], 20, RES_TYPE);
                return;
            }

            // 优先级3：其他孵化场附近的link（阈值从800降为100）
            var otherSpawnLinks = room.find(FIND_MY_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_LINK && 
                           s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0 &&
                           s.store.getUsedCapacity(RES_TYPE) > 100 &&
                           !(s.pos.x === 30 && s.pos.y === 24); // 排除已优先处理的link
                }
            });
            if (otherSpawnLinks.length > 0) {
                target = otherSpawnLinks[0];
            }
            
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取链路能量'], 20, RES_TYPE);
                return;
            }

            // 优先级4：矿源附近的容器（阈值从800降为100）
            var sourceContainers = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_CONTAINER && 
                           s.pos.findInRange(FIND_SOURCES, 2).length > 0 &&
                           s.store.getUsedCapacity(RES_TYPE) > 100;
                }
            });
            if (sourceContainers.length > 0) {
                target = sourceContainers[0];
            }
            
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取容器能量'], 20, RES_TYPE);
                return;
            }

            // 优先级5：地上掉落的能量
            var droppedResources = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                filter: function(r) {
                    return r.resourceType === RES_TYPE && r.amount > 500;
                }
            });
            if (droppedResources) {
                target = droppedResources;
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.pickup, '#00ffcc', ['捡地上能量'], 20, RES_TYPE);
                return;
            }

            // 优先级6：其他容器
            var containers = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_CONTAINER && 
                           s.store.getUsedCapacity(RES_TYPE) > 100;
                }
            });
            if (containers.length > 0) {
                target = containers[0];
            }
            
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取容器能量'], 20, RES_TYPE);
                return;
            }

            // 优先级7：仓库
            if (room.storage && room.storage.store.getUsedCapacity(RES_TYPE) > 10000) {
                target = room.storage;
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取仓库能量'], 20, RES_TYPE);
                return;
            }

            ToolUtil.sayWithDuration(creep, ['暂无货源']);
            creep.moveTo(SPAWN_LINK_POS, ToolUtil.getMoveOpts(50)); // 无货源时蹲守spawn旁link
            return;
        }

        if (creep.memory.working) {
            if (creep.memory.taskTargetId && creep.memory.targetType === 'transfer' && 
                Game.time < creep.memory.targetLockExpire && 
                isCachedTargetValid(creep.memory.taskTargetId, false)) {
                var target = Game.getObjectById(creep.memory.taskTargetId);
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量'], 20, RES_TYPE);
                return;
            }

            delete creep.memory.taskTargetId;
            delete creep.memory.targetLockExpire;
            delete creep.memory.targetType;

            var target = null;
            // 1. 空的孵化场/扩展（优先填满）
            var emptyCore = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: function(s) {
                    return (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                           s.store.getFreeCapacity(RES_TYPE) === s.store.getCapacity(RES_TYPE);
                }
            });
            
            if (!emptyCore) {
                // 2. 有空间的孵化场/扩展
                emptyCore = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                    filter: function(s) {
                        return (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                               s.store.getFreeCapacity(RES_TYPE) > 0;
                    }
                });
            }
            
            if (emptyCore) {
                target = emptyCore;
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量到孵化'], 20, RES_TYPE);
                return;
            }

            // 3. 能量不足80%的塔楼（阈值从50%提高到80%，更及时补能）
            var lowTower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_TOWER &&
                           s.store.getUsedCapacity(RES_TYPE) < s.store.getCapacity(RES_TYPE) * 0.8;
                }
            });
            
            if (lowTower) {
                target = lowTower;
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量到塔楼'], 20, RES_TYPE);
                return;
            }

            // 4. 实验室
            var lab = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_LAB &&
                           s.store.getFreeCapacity(RES_TYPE) > 0;
                }
            });
            
            if (lab) {
                target = lab;
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量到实验室'], 20, RES_TYPE);
                return;
            }

            // 5. 终端（能量不足保留值）
            if (room.terminal && room.terminal.store.getFreeCapacity(RES_TYPE) > 0 && 
                room.terminal.store.getUsedCapacity(RES_TYPE) < GLOBAL_CONFIG.TERMINAL.KEEP_ENERGY) {
                target = room.terminal;
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量到终端'], 20, RES_TYPE);
                return;
            }

            // 6. 仓库（兜底）
            if (room.storage && room.storage.store.getFreeCapacity(RES_TYPE) > 0) {
                target = room.storage;
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['存能量到仓库'], 20, RES_TYPE);
                return;
            }

            ToolUtil.sayWithDuration(creep, ['暂无需求']);
            // 移动到spawn旁link，等待新能量
            var spawnLinkPos = new RoomPosition(30, 24, room.name);
            creep.moveTo(spawnLinkPos, ToolUtil.getMoveOpts(50));
            return;
        }
    },

    // ========== 修复语法错误后的 upgrader 方法 ==========
    upgrader: function(creep) {
        var room = creep.room;
        // 关键：指定controller旁link的坐标（5,6），强制优先取能
        var CTRL_LINK_POS = new RoomPosition(5, 6, room.name);

        if (!creep.memory.working) {
            // 优先级1：强制优先从指定坐标的controller旁link取能【修复ES5兼容问题】
            var ctrlLinkStructures = CTRL_LINK_POS.lookFor(LOOK_STRUCTURES);
            var ctrlLink = null;
            if (ctrlLinkStructures.length > 0) {
                ctrlLink = Game.getObjectById(ctrlLinkStructures[0].id);
            }
            if (ctrlLink && ctrlLink.structureType === STRUCTURE_LINK && ctrlLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                if (ToolUtil.doAction(creep, ctrlLink, creep.withdraw, '#66ff66', ['取控制器链路'], 50)) {
                    return;
                }
            }

            // 优先级2：从source旁边的container取能（精准匹配source范围，阈值从500降为100）
            var sourceContainers = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_CONTAINER && 
                           s.pos.findInRange(FIND_SOURCES, 2).length > 0 && // 确保是source旁的container
                           s.store.getUsedCapacity(RESOURCE_ENERGY) > 100; // 降低阈值，更容易触发
                }
            });
            // 选择最近的source旁container
            if (sourceContainers.length > 0) {
                var nearestContainer = creep.pos.findClosestByPath(sourceContainers);
                if (nearestContainer && ToolUtil.doAction(creep, nearestContainer, creep.withdraw, '#66ff66', ['取矿源容器'], 50)) {
                    return;
                }
            }

            // 优先级3：其他controller旁的link（兜底）
            var otherCtrlLinks = room.find(FIND_MY_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_LINK && 
                           s.pos.inRangeTo(room.controller, 3) &&
                           s.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
                           !(s.pos.x === 5 && s.pos.y === 6); // 排除已优先处理的link
                }
            });
            if (otherCtrlLinks.length > 0 && ToolUtil.doAction(creep, otherCtrlLinks[0], creep.withdraw, '#66ff66', ['取链路能量'], 50)) {
                return;
            }

            // 优先级4：仓库（最后兜底）
            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                ToolUtil.doAction(creep, room.storage, creep.withdraw, '#66ff66', ['取仓库能量'], 50);
            }
            return;
        }
        
        ToolUtil.sayWithDuration(creep, ['升级控制器']);
        if (creep.upgradeController(room.controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(room.controller, ToolUtil.getMoveOpts(50));
        }
    },

    builder: function(creep) {
        var room = creep.room;
        if (!creep.memory.working) {
            // 控制器附近的link
            var ctrlLinks = room.find(FIND_MY_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_LINK && 
                           s.pos.inRangeTo(room.controller, 3) &&
                           s.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
                }
            });
            
            if (ctrlLinks.length > 0 && ToolUtil.doAction(creep, ctrlLinks[0], creep.withdraw, '#66ff66', ['取链路能量'], 50)) return;

            // 有能量的容器
            var sourceContainers = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return s.structureType === STRUCTURE_CONTAINER && 
                           s.store.getUsedCapacity(RESOURCE_ENERGY) > 500;
                }
            });
            
            if (sourceContainers.length > 0 && ToolUtil.doAction(creep, sourceContainers[0], creep.withdraw, '#66ff66', ['取容器能量'], 50)) return;

            // 仓库
            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                ToolUtil.doAction(creep, room.storage, creep.withdraw, '#66ff66', ['取仓库能量'], 50);
            }
            return;
        }
        
        // 建造建筑
        var constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
        if (constructionSites.length > 0) {
            var target = creep.pos.findClosestByPath(constructionSites);
            ToolUtil.sayWithDuration(creep, ['建造建筑']);
            if (creep.build(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, ToolUtil.getMoveOpts(50));
            }
            return;
        }
        
        // 维修建筑
        var damagedStructures = room.find(FIND_STRUCTURES, {
            filter: function(s) {
                return s.hits < s.hitsMax && 
                       s.structureType !== STRUCTURE_WALL && 
                       s.structureType !== STRUCTURE_RAMPART;
            }
        });
        
        if (damagedStructures.length > 0) {
            var target = creep.pos.findClosestByPath(damagedStructures);
            ToolUtil.sayWithDuration(creep, ['维修建筑']);
            if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, ToolUtil.getMoveOpts(50));
            }
        }
    },

    defender: function(creep) {
        var room = creep.room;
        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            var target = creep.pos.findClosestByPath(hostiles);
            ToolUtil.sayWithDuration(creep, ['攻击敌人']);
            if (creep.rangedAttack(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, ToolUtil.getMoveOpts(50));
            }
        } else {
            ToolUtil.sayWithDuration(creep, ['房间待命']);
            creep.moveTo(25, 25, ToolUtil.getMoveOpts(50));
        }
    },

    miner: function(creep) {
        var room = creep.room;
        if (!creep.memory.working) {
            var mineral = ToolUtil.assignZynthiumMineral(creep, room);
            if (mineral) ToolUtil.doAction(creep, mineral, creep.harvest, '#9900ff', ['开采Z矿'], 50, RESOURCE_ZYNTHIUM);
        } else {
            var target = room.terminal;
            var taskText = '存Z矿到终端';
            if (!target || target.store.getFreeCapacity(RESOURCE_ZYNTHIUM) === 0) {
                target = room.storage;
                taskText = '存Z矿到仓库';
            }
            
            if (target) ToolUtil.doAction(creep, target, creep.transfer, '#9900ff', [taskText], 50, RESOURCE_ZYNTHIUM);
        }
    }
};

// ===================== Tower管理器 (修复防御逻辑) =====================
var TowerManager = {
    run: function(room) {
        var towers = room.find(FIND_MY_STRUCTURES, {
            filter: function(s) {
                return s.structureType === STRUCTURE_TOWER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 10;
            }
        });
        
        if (towers.length === 0) return;

        // 1. 绝对优先：攻击所有敌方Creep
        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            var target = hostiles[0]; // 取第一个敌方即可，所有Tower攻击同一目标
            if (target) {
                for (var i = 0; i < towers.length; i++) {
                    var tower = towers[i];
                    var attackResult = tower.attack(target);
                    if (attackResult === OK) {
                        console.log('[Tower-' + tower.id + '] 攻击敌方Creep ' + (target.name || '未知') + ' (' + target.pos.x + ',' + target.pos.y + ')');
                    } else {
                        console.log('[Tower-' + tower.id + '] 攻击失败：' + attackResult);
                    }
                }
                return;
            }
        }

        // 2. 其次：治疗友方Creep
        var injured = room.find(FIND_MY_CREEPS, {
            filter: function(c) {
                return c.hits < c.hitsMax;
            }
        });
        
        if (injured.length > 0) {
            var target = injured[0];
            for (var j = 0; j < towers.length; j++) {
                towers[j].heal(target);
            }
            return;
        }

        // 3. 最后：维修
        if (towers[0].store.getUsedCapacity(RESOURCE_ENERGY) < 500) return;
        
        var repairTargets = room.find(FIND_STRUCTURES, {
            filter: function(s) {
                return s.hits < s.hitsMax && 
                       s.structureType !== STRUCTURE_WALL && 
                       s.structureType !== STRUCTURE_RAMPART;
            }
        });
        
        var walls = room.find(FIND_STRUCTURES, {
            filter: function(s) {
                return (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) && s.hits < 10000;
            }
        });
        
        var repairTarget = repairTargets.length > 0 ? repairTargets[0] : (walls.length > 0 ? walls[0] : null);
        if (repairTarget) {
            for (var k = 0; k < towers.length; k++) {
                towers[k].repair(repairTarget);
            }
        }
    }
};

// ===================== Link管理器 =====================
var LinkManager = {
    run: function(room) {
        if (Game.time % 5 !== 0) return;
        var links = room.find(FIND_MY_STRUCTURES, {
            filter: function(s) {
                return s.structureType === STRUCTURE_LINK;
            }
        });
        
        if (links.length < 2) return;

        var sourceLink = null; 
        var ctrlLink = null;   
        var bufferLink = null; 

        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            if (link.pos.findInRange(FIND_SOURCES, 2).length > 0) {
                sourceLink = link;
            } else if (link.pos.inRangeTo(room.controller, 3)) {
                ctrlLink = link;
            } else if (link.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0) {
                bufferLink = link;
            }
        }

        if (sourceLink && sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > 400) {
            if (bufferLink && bufferLink.store.getFreeCapacity(RESOURCE_ENERGY) > 100) {
                sourceLink.transferEnergy(bufferLink);
            } else if (ctrlLink && ctrlLink.store.getUsedCapacity(RESOURCE_ENERGY) < 100) {
                sourceLink.transferEnergy(ctrlLink);
            }
        }
    }
};

// ===================== Terminal 管理器 (修复transfer错误) =====================
var TerminalManager = {
    ERROR_MSG: {
        ERR_NOT_OWNER: "无订单所有权",
        ERR_NOT_ENOUGH_RESOURCES: "Terminal Z矿不足",
        ERR_INVALID_TARGET: "订单无效/已过期",
        ERR_NOT_IN_RANGE: "距离过远（需Terminal）",
        ERR_TIRED: "Terminal冷却中（需等待10 tick）",
        ERR_NO_PATH: "无运输路径",
        ERR_FULL: "买方库存已满",
        ERR_INVALID_ARGS: "参数错误（订单ID/数量无效）",
        ERR_NOT_ENOUGH_ENERGY: "Terminal能量不足，无法支付手续费"
    },

    run: function(room) {
        var terminal = room.terminal;
        if (!ToolUtil.isTargetValid(terminal)) {
            console.log('[' + room.name + '] Terminal未建成/无效，跳过Z矿出售');
            return;
        }

        this.manageTerminalEnergy(terminal, room);
        this.sellZynthium(terminal, room);
    },

    manageTerminalEnergy: function(terminal, room) {
        var keepEnergy = GLOBAL_CONFIG.TERMINAL.KEEP_ENERGY;
        var terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);

        // 修复核心错误：Terminal只能用send方法转移资源（即使同房间）
        if (terminalEnergy > keepEnergy && ToolUtil.isTargetValid(room.storage)) {
            var transferAmount = Math.min(terminalEnergy - keepEnergy, 5000);
            // 正确用法：terminal.send(资源类型, 数量, 目标房间, 目标结构ID)
            var result = terminal.send(RESOURCE_ENERGY, transferAmount, room.name, room.storage.id);
            if (result === OK) {
                console.log('[' + room.name + '] Terminal转移' + transferAmount + '能源至Storage（当前：' + terminalEnergy + '→' + (terminalEnergy-transferAmount) + '）');
            } else if (result !== ERR_TIRED) { // 冷却中不报错
                console.log('[' + room.name + '] Terminal转移能量失败：' + (this.ERROR_MSG[result] || '错误码' + result));
            }
        }
    },

    sellZynthium: function(terminal, room) {
        var config = GLOBAL_CONFIG.TERMINAL;
        var zAmount = terminal.store.getUsedCapacity(RESOURCE_ZYNTHIUM);

        // 1. 基础校验
        if (config.COOLDOWN_CHECK && terminal.cooldown > 0) {
            console.log('[' + room.name + '] Terminal处于冷却中（剩余' + terminal.cooldown + ' tick），跳过Z矿出售');
            return;
        }
        if (zAmount < config.SELL_ZYNTHIUM_THRESHOLD) {
            console.log('[' + room.name + '] Z矿库存: ' + zAmount + '（未达出售阈值' + config.SELL_ZYNTHIUM_THRESHOLD + '）');
            return;
        }

        // 2. 计算可出售数量
        var sellableAmount = Math.min(zAmount - config.KEEP_ZYNTHIUM, config.MAX_SINGLE_SELL);
        if (sellableAmount <= 0) {
            console.log('[' + room.name + '] Z矿库存: ' + zAmount + '（保留' + config.KEEP_ZYNTHIUM + '后无可用出售量）');
            return;
        }

        // 3. 获取有效订单
        var buyOrders = Game.market.getAllOrders({
            type: ORDER_BUY,
            resourceType: RESOURCE_ZYNTHIUM
        });
        
        if (buyOrders.length === 0) {
            console.log('[' + room.name + '] 无Z矿收购订单，暂不出售');
            return;
        }
        
        // 过滤有效订单
        var validOrders = [];
        for (var i = 0; i < buyOrders.length; i++) {
            var order = buyOrders[i];
            if (order.price >= config.MIN_PRICE && order.amount >= 100) {
                validOrders.push(order);
            }
        }
        
        if (validOrders.length === 0) {
            console.log('[' + room.name + '] 无符合条件的Z矿订单（最低可接受价：' + config.MIN_PRICE + '）');
            return;
        }

        // 4. 按价格排序选择最优订单
        validOrders.sort(function(a, b) {
            return b.price - a.price;
        });
        
        var bestOrder = validOrders[0];
        var dealAmount = Math.min(sellableAmount, bestOrder.amount);
        var fee = ToolUtil.calculateDealFee(dealAmount, bestOrder.price);
        var terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);

        // 关键校验：确保终端能量足够支付手续费
        if (terminalEnergy < fee + config.MIN_ENERGY_FOR_DEAL) {
            console.log('[' + room.name + '] Terminal能量不足（当前：' + terminalEnergy + '，需手续费' + fee + '+保底' + config.MIN_ENERGY_FOR_DEAL + '），跳过交易');
            return;
        }

        // 5. 执行交易
        var dealResult = Game.market.deal(bestOrder.id, dealAmount, room.name);
        this.logDealResult(room.name, dealResult, dealAmount, bestOrder.price, fee);
    },

    logDealResult: function(roomName, result, amount, price, fee) {
        if (result === OK) {
            var income = Math.floor(amount * price);
            var netIncome = income - fee;
            console.log('[' + roomName + '] Z矿出售成功！\n' +
                '    数量：' + amount + ' | 单价：' + price + '\n' +
                '    毛收入：' + income + ' | 手续费：' + fee + ' | 净收入：' + netIncome);
        } else {
            var errMsg = this.ERROR_MSG[result] || "未知错误（错误码："+result+"）";
            console.log('[ERROR][' + roomName + '] Z矿出售失败！\n' +
                '    错误码：' + result + ' | 原因：' + errMsg + '\n' +
                '    尝试出售：' + amount + '单位 Z矿 @ ' + price + '单价');
        }
    }
};

// ===================== Lab 管理器 =====================
var LabManager = {
    run: function(room) {
        var labs = room.find(FIND_MY_STRUCTURES, {
            filter: function(s) {
                return s.structureType === STRUCTURE_LAB;
            }
        });
        
        if (labs.length < 3) return;

        var labOut = labs[0];
        var labIn1 = labs[1];
        var labIn2 = labs[2];
        
        var mineral = ToolUtil.assignZynthiumMineral(null, room);
        if (!mineral) return;

        var z1 = labIn1.store.getUsedCapacity(RESOURCE_ZYNTHIUM);
        var z2 = labIn2.store.getUsedCapacity(RESOURCE_ZYNTHIUM);
        
        if (z1 > 0 && z2 > 0 && labOut.store.getFreeCapacity() > 0) {
            console.log('[' + room.name + '] Lab准备合成Ghodium，输入Z矿：' + z1 + '+' + z2);
        }
    }
};

// ===================== 主循环 =====================
module.exports.loop = function () {
    // 内存清理
    if (Game.time % 100 === 0) {
        for (var name in Memory.creeps) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
            }
        }
        console.log('[清理] 已移除失效Creep内存，当前Creep数量：' + Object.keys(Game.creeps).length);
    }

    // 房间逻辑执行
    for (var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) continue;

        SpawnManager.run(room);
        LinkManager.run(room);
        TowerManager.run(room); // 优先执行Tower防御
        CreepLogic.run(room);
        TerminalManager.run(room);
        LabManager.run(room);
    }
};