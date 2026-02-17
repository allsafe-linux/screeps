// ===================== 全局配置 (整合优化) =====================
const GLOBAL_CONFIG = {
    HOME_ROOM: 'W13S59',
    LAB_RECIPES: [
        {id: 'GHOUL', result: RESOURCE_GHODIUM, in: [RESOURCE_ZYNTHIUM, RESOURCE_ZYNTHIUM]}
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
        var texts = Array.isArray(textList) ? textList : [textList];
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
        const SOURCE_CHANGE_COOLDOWN = 50;
        const isTaskCompleted = function() {
            if (creep.memory.currentSourceTaskId) {
                const currentSource = Game.getObjectById(creep.memory.currentSourceTaskId);
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
            console.log(`[${creep.name}] 房间${room.name}无可用矿源！`);
            return null;
        }

        let currentSource = null;
        if (creep.memory.currentSourceTaskId) {
            currentSource = Game.getObjectById(creep.memory.currentSourceTaskId);
        }
        if (!isTaskCompleted() && ToolUtil.isTargetValid(currentSource) && allSources.some(s => s.id === currentSource.id)) {
            if (Game.time % 10 === 0) {
                console.log(`[${creep.name}] 继续采集矿源[${currentSource.pos.x},${currentSource.pos.y}]`);
            }
            return currentSource;
        }

        var sourceLoad = {};
        allSources.forEach(function(s) {
            sourceLoad[s.id] = {
                count: 0,
                source: s,
                distance: creep.pos.getRangeTo(s)
            };
        });

        var harvesterRoles = ['harvester', 'upgrader'];
        for (const name in Game.creeps) {
            const creepIter = Game.creeps[name];
            if (creepIter.room.name === room.name && harvesterRoles.includes(creepIter.memory.role) && creepIter.memory.currentSourceTaskId) {
                if (sourceLoad[creepIter.memory.currentSourceTaskId]) {
                    sourceLoad[creepIter.memory.currentSourceTaskId].count++;
                }
            }
        }

        var bestSource = _.min(allSources, function(s) {
            return sourceLoad[s.id].count * 10 + sourceLoad[s.id].distance;
        });

        creep.memory.currentSourceTaskId = bestSource.id;
        creep.memory.sourceChangeCooldown = Game.time + SOURCE_CHANGE_COOLDOWN;
        console.log(`[${creep.name}] 分配新矿源：[${bestSource.pos.x},${bestSource.pos.y}]`);
        return bestSource;
    },

    assignZynthiumMineral: function(creep, room) {
        const zMinerals = room.find(FIND_MINERALS, {
            filter: m => m.mineralType === RESOURCE_ZYNTHIUM && m.mineralAmount > 0
        });
        if (zMinerals.length === 0) return null;
        
        return zMinerals.find(m => {
            return m.pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_EXTRACTOR);
        }) || zMinerals[0];
    },
    
    getNearbyStructures: function(pos, structureType, hasEnergy) {
        return pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (s) => {
                if (s.structureType !== structureType) return false;
                if (hasEnergy === undefined) return true;
                if (hasEnergy) return s.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        })[0];
    },

    getBodyCost: function(body) {
        var costMap = { WORK: 100, CARRY: 50, MOVE: 50, ATTACK: 80, RANGED_ATTACK: 150, TOUGH: 10, CLAIM: 600 };
        var sum = 0;
        for (var i = 0; i < body.length; i++) sum += costMap[body[i]] || 0;
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
        harvester: [WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE],
        transporter: [CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE],
        upgrader: [WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE], 
        builder: [WORK,WORK,CARRY,CARRY,CARRY,MOVE,MOVE],
        defender: [RANGED_ATTACK, RANGED_ATTACK, TOUGH, TOUGH, MOVE, MOVE, MOVE],
        miner: [WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE],
        scout: [MOVE],
        attacker: [RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, TOUGH, MOVE, MOVE, MOVE]
    },
    CREEP_NUM: { 
        harvester: 4, transporter: 1, upgrader: 4, builder: 1, 
        defender: 0, miner: 0, scout: 0, attacker: 0
    },
    PRIORITY: ['harvester', 'transporter', 'upgrader', 'miner', 'builder', 'defender'],
    
    init: function() {
        this.BODY_COST = {};
        for (var role in this.BODIES) this.BODY_COST[role] = ToolUtil.getBodyCost(this.BODIES[role]);
    },

    run: function(room) {
        if (!this.BODY_COST) this.init();
        var spawn = room.find(FIND_MY_SPAWNS)[0];
        if (!spawn || spawn.spawning) return;

        var counts = {};
        for (let r in this.CREEP_NUM) counts[r] = 0;
        room.find(FIND_MY_CREEPS).forEach(c => { if(counts[c.memory.role] !== undefined) counts[c.memory.role]++; });

        const zMineral = ToolUtil.assignZynthiumMineral(null, room);
        const extractor = zMineral ? zMineral.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_EXTRACTOR) : null;
        
        if (zMineral && extractor && zMineral.mineralAmount > 0) {
            this.CREEP_NUM.miner = 1;
        } else {
            this.CREEP_NUM.miner = 0;
        }

        for (var i = 0; i < this.PRIORITY.length; i++) {
            var role = this.PRIORITY[i];
            if (counts[role] >= this.CREEP_NUM[role]) continue;
            
            var body = room.energyAvailable >= this.BODY_COST[role] ? this.BODIES[role] : [WORK,CARRY,MOVE];
            var name = role + '_' + Game.time;
            var mem = { role: role, working: false, room: room.name };
            
            if (spawn.spawnCreep(body, name, {memory: mem}) === OK) {
                console.log(`[Spawn] 孵化 ${name}`);
                return;
            }
        }
    }
};

// ===================== Creep逻辑 =====================
var CreepLogic = {
    run: function(room) {
        room.find(FIND_MY_CREEPS).forEach(creep => {
            if (!ToolUtil.isTargetValid(creep)) return;
            this.switchState(creep);
            if (this[creep.memory.role]) this[creep.memory.role](creep);
        });
    },

    switchState: function(creep) {
        if (['defender', 'scout', 'attacker'].includes(creep.memory.role)) return;
        
        const resType = creep.memory.role === 'miner' ? RESOURCE_ZYNTHIUM : RESOURCE_ENERGY;
        const used = creep.store.getUsedCapacity(resType);
        const free = creep.store.getFreeCapacity(resType);

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
        const room = creep.room;
        if (!creep.memory.working) {
            const source = ToolUtil.assignSource(creep, room);
            if (!source) {
                console.log(`[Harvester-${creep.name}] 无可用矿源！`);
                return;
            }
            ToolUtil.doAction(creep, source, creep.harvest, '#ffaa00', ['采集能源'], 50, RESOURCE_ENERGY);
            return;
        }

        let source = null;
        if (creep.memory.currentSourceTaskId) {
            source = Game.getObjectById(creep.memory.currentSourceTaskId);
        }
        if (!ToolUtil.isTargetValid(source)) {
            source = ToolUtil.assignSource(creep, room);
        }

        if (source) {
            const link = ToolUtil.getNearbyStructures(source.pos, STRUCTURE_LINK, false);
            if (link && ToolUtil.doAction(creep, link, creep.transfer, '#ffaa00', ['存矿到链路'], 50)) return;
        }

        if (source) {
            const cont = ToolUtil.getNearbyStructures(source.pos, STRUCTURE_CONTAINER, false);
            if (cont && ToolUtil.doAction(creep, cont, creep.transfer, '#ffaa00', ['存矿到容器'], 50)) return;
        }

        const core = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) 
                         && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        if (core && ToolUtil.doAction(creep, core, creep.transfer, '#ffaa00', ['送矿到孵化'], 50)) return;

        if (room.storage && ToolUtil.doAction(creep, room.storage, creep.transfer, '#ffaa00', ['存矿到仓库'], 50)) return;
    },

    transporter: function(creep) {
        const room = creep.room;
        const RES_TYPE = RESOURCE_ENERGY;
        const TARGET_LOCK_TICK = 10;

        const isCachedTargetValid = (targetId, isWithdraw) => {
            if (!targetId) return false;
            const target = Game.getObjectById(targetId);
            if (!ToolUtil.isTargetValid(target)) return false;
            
            if (isWithdraw) {
                return target.store.getUsedCapacity(RES_TYPE) > 50 
                    && creep.store.getFreeCapacity(RES_TYPE) > 0;
            }
            return target.store.getFreeCapacity(RES_TYPE) > 0 
                && creep.store.getUsedCapacity(RES_TYPE) > 0;
        };

        const lockTarget = (target, type) => {
            creep.memory.taskTargetId = target.id;
            creep.memory.targetLockExpire = Game.time + TARGET_LOCK_TICK;
            creep.memory.targetType = type;
            console.log(`[Transporter-${creep.name}] 锁定${type}目标：${target.structureType}(${target.pos.x},${target.pos.y})`);
        };

        if (!creep.memory.working) {
            if (creep.memory.taskTargetId && creep.memory.targetType === 'withdraw' 
                && Game.time < creep.memory.targetLockExpire 
                && isCachedTargetValid(creep.memory.taskTargetId, true)) {
                const target = Game.getObjectById(creep.memory.taskTargetId);
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取能量'], 20, RES_TYPE);
                return;
            }

            delete creep.memory.taskTargetId;
            delete creep.memory.targetLockExpire;
            delete creep.memory.targetType;

            let target = null;
            target = room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_LINK 
                            && s.pos.findInRange(FIND_SOURCES, 2).length > 0
                            && s.store.getUsedCapacity(RES_TYPE) > 800
            })[0];
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取链路能量'], 20, RES_TYPE);
                return;
            }

            target = room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_LINK 
                            && s.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0
                            && s.store.getUsedCapacity(RES_TYPE) > 800
            })[0];
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取链路能量'], 20, RES_TYPE);
                return;
            }

            target = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER 
                            && s.pos.findInRange(FIND_SOURCES, 2).length > 0
                            && s.store.getUsedCapacity(RES_TYPE) > 800
            })[0];
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取容器能量'], 20, RES_TYPE);
                return;
            }

            target = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
                filter: r => r.resourceType === RES_TYPE && r.amount > 500
            });
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.pickup, '#00ffcc', ['捡地上能量'], 20, RES_TYPE);
                return;
            }

            target = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER 
                            && s.store.getUsedCapacity(RES_TYPE) > 800
            })[0];
            if (target) {
                lockTarget(target, 'withdraw');
                ToolUtil.doAction(creep, target, creep.withdraw, '#00ffcc', ['取容器能量'], 20, RES_TYPE);
                return;
            }

            if (room.storage && room.storage.store.getUsedCapacity(RES_TYPE) > 10000) {
                lockTarget(room.storage, 'withdraw');
                ToolUtil.doAction(creep, room.storage, creep.withdraw, '#00ffcc', ['取仓库能量'], 20, RES_TYPE);
                return;
            }

            ToolUtil.sayWithDuration(creep, ['暂无货源']);
            creep.moveTo(room.controller.pos, ToolUtil.getMoveOpts(50));
            return;
        }

        if (creep.memory.working) {
            if (creep.memory.taskTargetId && creep.memory.targetType === 'transfer' 
                && Game.time < creep.memory.targetLockExpire 
                && isCachedTargetValid(creep.memory.taskTargetId, false)) {
                const target = Game.getObjectById(creep.memory.taskTargetId);
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量'], 20, RES_TYPE);
                return;
            }

            delete creep.memory.taskTargetId;
            delete creep.memory.targetLockExpire;
            delete creep.memory.targetType;

            let target = null;
            target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION)
                            && s.store.getFreeCapacity(RES_TYPE) === s.store.getCapacity(RES_TYPE)
            });
            if (!target) {
                target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                    filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION)
                                && s.store.getFreeCapacity(RES_TYPE) > 0
                });
            }
            if (target) {
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量到孵化'], 20, RES_TYPE);
                return;
            }

            target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_TOWER
                            && s.store.getUsedCapacity(RES_TYPE) < s.store.getCapacity(RES_TYPE) * 0.5
            });
            if (target) {
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量到塔楼'], 20, RES_TYPE);
                return;
            }

            target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_LAB
                            && s.store.getFreeCapacity(RES_TYPE) > 0
            });
            if (target) {
                lockTarget(target, 'transfer');
                ToolUtil.doAction(creep, target, creep.transfer, '#00ffcc', ['送能量到实验室'], 20, RES_TYPE);
                return;
            }

            if (room.terminal && room.terminal.store.getFreeCapacity(RES_TYPE) > 0 
                && room.terminal.store.getUsedCapacity(RES_TYPE) < GLOBAL_CONFIG.TERMINAL.KEEP_ENERGY) {
                lockTarget(room.terminal, 'transfer');
                ToolUtil.doAction(creep, room.terminal, creep.transfer, '#00ffcc', ['送能量到终端'], 20, RES_TYPE);
                return;
            }

            if (room.storage && room.storage.store.getFreeCapacity(RES_TYPE) > 0) {
                lockTarget(room.storage, 'transfer');
                ToolUtil.doAction(creep, room.storage, creep.transfer, '#00ffcc', ['存能量到仓库'], 20, RES_TYPE);
                return;
            }

            ToolUtil.sayWithDuration(creep, ['暂无需求']);
            creep.moveTo(room.spawns[Object.keys(room.spawns)[0]].pos, ToolUtil.getMoveOpts(50));
            return;
        }
    },

    upgrader: function(creep) {
        const room = creep.room;
        if (!creep.memory.working) {
            const ctrlLink = room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_LINK && 
                             s.pos.inRangeTo(room.controller, 3) &&
                             s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            })[0];
            if (ctrlLink && ToolUtil.doAction(creep, ctrlLink, creep.withdraw, '#66ff66', ['取链路能量'], 50)) return;

            const sourceCont = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && 
                             s.store.getUsedCapacity(RESOURCE_ENERGY) > 500
            })[0];
            if (sourceCont && ToolUtil.doAction(creep, sourceCont, creep.withdraw, '#66ff66', ['取容器能量'], 50)) return;

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
        const room = creep.room;
        if (!creep.memory.working) {
            const ctrlLink = room.find(FIND_MY_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_LINK && 
                             s.pos.inRangeTo(room.controller, 3) &&
                             s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            })[0];
            if (ctrlLink && ToolUtil.doAction(creep, ctrlLink, creep.withdraw, '#66ff66', ['取链路能量'], 50)) return;

            const sourceCont = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && 
                             s.store.getUsedCapacity(RESOURCE_ENERGY) > 500
            })[0];
            if (sourceCont && ToolUtil.doAction(creep, sourceCont, creep.withdraw, '#66ff66', ['取容器能量'], 50)) return;

            if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                ToolUtil.doAction(creep, room.storage, creep.withdraw, '#66ff66', ['取仓库能量'], 50);
            }
            return;
        }
        
        const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
        if (constructionSites.length > 0) {
            const target = creep.pos.findClosestByPath(constructionSites);
            ToolUtil.sayWithDuration(creep, ['建造建筑']);
            if (creep.build(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, ToolUtil.getMoveOpts(50));
            }
            return;
        }
        
        const damagedStructures = room.find(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax && 
                         s.structureType !== STRUCTURE_WALL && 
                         s.structureType !== STRUCTURE_RAMPART
        });
        if (damagedStructures.length > 0) {
            const target = creep.pos.findClosestByPath(damagedStructures);
            ToolUtil.sayWithDuration(creep, ['维修建筑']);
            if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, ToolUtil.getMoveOpts(50));
            }
        }
    },

    defender: function(creep) {
        const room = creep.room;
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            const target = creep.pos.findClosestByPath(hostiles);
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
        const room = creep.room;
        if (!creep.memory.working) {
            const mineral = ToolUtil.assignZynthiumMineral(creep, room);
            if (mineral) ToolUtil.doAction(creep, mineral, creep.harvest, '#9900ff', ['开采Z矿'], 50, RESOURCE_ZYNTHIUM);
        } else {
            let target = room.terminal;
            let taskText = '存Z矿到终端';
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
        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 10
        });
        if (towers.length === 0) return;

        // 1. 绝对优先：攻击所有敌方Creep（修复排序逻辑，兼容无攻击部件的敌方）
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            // 修复：简化排序逻辑，优先攻击距离最近的敌方（避免排序异常）
            const target = room.find(FIND_HOSTILE_CREEPS)[0]; // 取第一个敌方即可，所有Tower攻击同一目标
            if (target) {
                towers.forEach(tower => {
                    // 强制攻击，忽略角色/部件类型
                    const attackResult = tower.attack(target);
                    if (attackResult === OK) {
                        console.log(`[Tower-${tower.id}] 攻击敌方Creep ${target.name} (${target.pos.x},${target.pos.y})`);
                    } else {
                        console.log(`[Tower-${tower.id}] 攻击失败：${attackResult}`);
                    }
                });
                return;
            }
        }

        // 2. 其次：治疗友方Creep
        const injured = room.find(FIND_MY_CREEPS, {filter: c => c.hits < c.hitsMax});
        if (injured.length > 0) {
            const target = injured[0];
            towers.forEach(tower => tower.heal(target));
            return;
        }

        // 3. 最后：维修（所有Tower都参与维修）
        if (towers[0].store.getUsedCapacity(RESOURCE_ENERGY) < 500) return;
        
        const targets = room.find(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax && 
                         s.structureType !== STRUCTURE_WALL && 
                         s.structureType !== STRUCTURE_RAMPART
        });
        const walls = room.find(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) && s.hits < 10000
        });
        
        const repairTarget = targets[0] || walls[0];
        if (repairTarget) {
            towers.forEach(tower => tower.repair(repairTarget));
        }
    }
};

// ===================== Link管理器 =====================
var LinkManager = {
    run: function(room) {
        if (Game.time % 5 !== 0) return;
        const links = room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_LINK});
        if (links.length < 2) return;

        let sourceLink = null; 
        let ctrlLink = null;   
        let bufferLink = null; 

        links.forEach(link => {
            if (link.pos.findInRange(FIND_SOURCES, 2).length > 0) sourceLink = link;
            else if (link.pos.inRangeTo(room.controller, 3)) ctrlLink = link;
            else if (link.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0) bufferLink = link;
        });

        if (sourceLink && sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > 400) {
            if (bufferLink && bufferLink.store.getFreeCapacity(RESOURCE_ENERGY) > 100) {
                sourceLink.transferEnergy(bufferLink);
            } 
            else if (ctrlLink && ctrlLink.store.getUsedCapacity(RESOURCE_ENERGY) < 100) {
                sourceLink.transferEnergy(ctrlLink);
            }
        }
    }
};

// ===================== Terminal 管理器 (彻底移除延迟校验 + 真实交易逻辑) =====================
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
        const terminal = room.terminal;
        if (!ToolUtil.isTargetValid(terminal)) {
            console.log(`[${room.name}] Terminal未建成/无效，跳过Z矿出售`);
            return;
        }

        this.manageTerminalEnergy(terminal, room);
        this.sellZynthium(terminal, room);
    },

    manageTerminalEnergy: function(terminal, room) {
        const keepEnergy = GLOBAL_CONFIG.TERMINAL.KEEP_ENERGY;
        const terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);

        if (terminalEnergy > keepEnergy && ToolUtil.isTargetValid(room.storage)) {
            const transferAmount = Math.min(terminalEnergy - keepEnergy, 5000);
            const result = terminal.send(RESOURCE_ENERGY, transferAmount, room.name);
            if (result === OK) {
                console.log(`[${room.name}] Terminal转移${transferAmount}能源至Storage（当前：${terminalEnergy}→${terminalEnergy-transferAmount}）`);
            }
        }
    },

    sellZynthium: function(terminal, room) {
        const config = GLOBAL_CONFIG.TERMINAL;
        const zAmount = terminal.store.getUsedCapacity(RESOURCE_ZYNTHIUM);

        // 1. 基础校验
        if (config.COOLDOWN_CHECK && terminal.cooldown > 0) {
            console.log(`[${room.name}] Terminal处于冷却中（剩余${terminal.cooldown} tick），跳过Z矿出售`);
            return;
        }
        if (zAmount < config.SELL_ZYNTHIUM_THRESHOLD) {
            console.log(`[${room.name}] Z矿库存: ${zAmount}（未达出售阈值${config.SELL_ZYNTHIUM_THRESHOLD}）`);
            return;
        }

        // 2. 计算可出售数量
        const sellableAmount = Math.min(zAmount - config.KEEP_ZYNTHIUM, config.MAX_SINGLE_SELL);
        if (sellableAmount <= 0) {
            console.log(`[${room.name}] Z矿库存: ${zAmount}（保留${config.KEEP_ZYNTHIUM}后无可用出售量）`);
            return;
        }

        // 3. 获取有效订单
        const buyOrders = Game.market.getAllOrders({
            type: ORDER_BUY,
            resourceType: RESOURCE_ZYNTHIUM
        });
        if (buyOrders.length === 0) {
            console.log(`[${room.name}] 无Z矿收购订单，暂不出售`);
            return;
        }
        const validOrders = buyOrders.filter(order => {
            return order.price >= config.MIN_PRICE && order.amount >= 100;
        });
        if (validOrders.length === 0) {
            console.log(`[${room.name}] 无符合条件的Z矿订单（最低可接受价：${config.MIN_PRICE}）`);
            return;
        }

        // 4. 选择最优订单并校验手续费
        validOrders.sort((a, b) => b.price - a.price);
        const bestOrder = validOrders[0];
        const dealAmount = Math.min(sellableAmount, bestOrder.amount);
        const fee = ToolUtil.calculateDealFee(dealAmount, bestOrder.price);
        const terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);

        // 关键校验：确保终端能量足够支付手续费
        if (terminalEnergy < fee + config.MIN_ENERGY_FOR_DEAL) {
            console.log(`[${room.name}] Terminal能量不足（当前：${terminalEnergy}，需手续费${fee}+保底${config.MIN_ENERGY_FOR_DEAL}），跳过交易`);
            return;
        }

        // 5. 执行交易并记录结果（移除所有延迟校验逻辑）
        const dealResult = Game.market.deal(bestOrder.id, dealAmount, room.name);
        this.logDealResult(room.name, dealResult, dealAmount, bestOrder.price, fee);
    },

    logDealResult: function(roomName, result, amount, price, fee) {
        if (result === OK) {
            const income = Math.floor(amount * price);
            const netIncome = income - fee;
            console.log(`[${roomName}] Z矿出售成功！
                数量：${amount} | 单价：${price}
                毛收入：${income} | 手续费：${fee} | 净收入：${netIncome}`);
        } else {
            const errMsg = this.ERROR_MSG[result] || "未知错误（错误码："+result+"）";
            console.log(`[ERROR][${roomName}] Z矿出售失败！
                错误码：${result} | 原因：${errMsg}
                尝试出售：${amount}单位 Z矿 @ ${price}单价`);
        }
    }
};

// ===================== Lab 管理器 =====================
var LabManager = {
    run: function(room) {
        const labs = room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_LAB});
        if (labs.length < 3) return;

        const labOut = labs[0];
        const labIn1 = labs[1];
        const labIn2 = labs[2];
        
        const mineral = ToolUtil.assignZynthiumMineral(null, room);
        if (!mineral) return;

        const z1 = labIn1.store.getUsedCapacity(RESOURCE_ZYNTHIUM);
        const z2 = labIn2.store.getUsedCapacity(RESOURCE_ZYNTHIUM);
        
        if (z1 > 0 && z2 > 0 && labOut.store.getFreeCapacity() > 0) {
            console.log(`[${room.name}] Lab准备合成Ghodium，输入Z矿：${z1}+${z2}`);
        }
    }
};

// ===================== 主循环 =====================
module.exports.loop = function () {
    if (Game.time % 100 === 0) {
        for (var name in Memory.creeps) {
            if (!Game.creeps[name]) delete Memory.creeps[name];
        }
        console.log(`[清理] 已移除失效Creep内存，当前Creep数量：${Object.keys(Game.creeps).length}`);
    }

    for (var roomName in Game.rooms) {
        var room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) continue;

        SpawnManager.run(room);
        LinkManager.run(room);
        TowerManager.run(room); // 优先执行Tower防御，避免延迟
        CreepLogic.run(room);
        TerminalManager.run(room);
        LabManager.run(room);
    }
};
