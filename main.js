// 基础配置
const MAIN_ROOM = "XXXXXX"; // 主房间（仅作为远程房间的控制中心）
const RESERVE_ROOMS = ["XXXXXX","XXXXXX"];
const CLAIM_ROOMS = ["XXXXXX","XXXXXX"];

// 阈值配置
const EMERGENCY_ENERGY_LIMIT = 300;
const WALL_REPAIR_LIMIT = 100000;
const RESERVE_CREEP_RENEW_THRESHOLD = 300;
const MIN_CREEP_ENERGY = 300;

// 全局缓存
global.RoleCache = {};

/* ================= 主循环 ================= */
module.exports.loop = function () {
    cleanMemory();
    buildRoleCache();

    // 初始化远程房间配置（仅主房间执行）
    initRemoteRooms();

    // ========== 核心修改1：遍历所有自有房间，每个房间独立执行逻辑 ==========
    for (let roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        // 只处理「有控制器且属于自己」的房间（主房间+新占领房间）
        if (!room.controller || !room.controller.my) continue;

        checkEmergencyMode(room);
        // 每个自有房间都执行本地经济逻辑（孵化自己的creep）
        runLocalEconomy(room);
        
        // 仅主房间执行远程系统（远程采集/保留）
        if (room.name === MAIN_ROOM) {
            runRemoteSystem(room);
        }

        // 核心设施逻辑（每个房间都执行自己的Link/Tower逻辑）
        towerLogic(room);
        linkLogic(room);
        
        // 市场贸易逻辑（仅主房间执行，或你想让新房间也执行可去掉判断）
        if (!Memory.roomEmergency[room.name] && room.name === MAIN_ROOM) {
            runMarket(room);
        }
    }

    // ========== Pixel 逻辑移到这里（全局只执行一次） ==========
    // 1. 自动生成Pixel（仅主房间执行，且每100 Tick一次）
    const mainRoom = Game.rooms[MAIN_ROOM];
    if (mainRoom && mainRoom.controller && mainRoom.controller.my) { // 确保主房间存在且属于自己
        if (Game.time % 100 === 0 && !Memory.roomEmergency[MAIN_ROOM]) {
            const generateResult = generatePixelSafely();
            console.log(`[Pixel生成] ${generateResult}`);
        }

        // 2. 手动抽卡函数（全局只定义一次）
        if (!global.drawCard) { // 避免重复定义
            global.drawCard = function(count) {
                const result = drawCardWithPixel(count);
                console.log(`[Pixel抽卡] ${result}`);
                return result;
            }
        }
    }

    runAllCreeps();
};

/* ================= MEMORY CLEAN ================= */
function cleanMemory() {
    // 清理死亡creep内存
    for (let name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }

    // 清理过期的房间内存
    for (let roomName in Memory.rooms) {
        if (!Game.rooms[roomName]) {
            delete Memory.rooms[roomName];
        }
    }

    // 初始化应急模式内存
    if (!Memory.roomEmergency) Memory.roomEmergency = {};
}

/**
 * 安全生成Pixel（自动检查冷却和CPU）
 * @returns {string} 执行结果（成功/冷却/CPU不足）
 */
function generatePixelSafely() {
    // 1. 检查全局冷却（用内存记录上次生成时间）
    if (!Memory.pixelLastGenerate) Memory.pixelLastGenerate = 0;
    const cooldownLeft = Memory.pixelLastGenerate + 100 - Game.time;
    
    if (cooldownLeft > 0) {
        return `Pixel生成冷却中，剩余${cooldownLeft}Tick`;
    }

    // 2. 直接调用API（API会自动检查CPU是否足够）
    const result = Game.cpu.generatePixel();
    
    if (result === OK) {
        Memory.pixelLastGenerate = Game.time;
        Memory.pixelCount = (Memory.pixelCount || 0) + 1;
        return `成功生成1个Pixel，累计${Memory.pixelCount}个`;
    } else if (result === ERR_BUSY) {
        return `Pixel生成失败：冷却中（ERR_BUSY）`;
    } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        return `Pixel生成失败：当前CPU上限(${Game.cpu.limit})不足1000，无法生成`;
    } else {
        return `Pixel生成失败：未知错误（${result}）`;
    }
}

/**
 * Pixel抽卡逻辑（模拟官方抽卡规则）
 * @param {number} count - 抽卡次数（每次消耗10 Pixel）
 * @returns {string} 抽卡结果
 */
function drawCardWithPixel(count = 1) {
    // 1. 检查Pixel数量（需先在游戏内查看自己的Pixel总数：Game.pixelBalance）
    const pixelBalance = Game.pixelBalance; // 账号总Pixel数（官方API）
    const cost = count * 10; // 假设每次抽卡消耗10 Pixel
    
    if (pixelBalance < cost) {
        return `Pixel不足！需要${cost}个，当前只有${pixelBalance}个`;
    }

    // 2. 模拟抽卡奖励池（可根据官方规则修改）
    const rewardPool = [
        { name: "临时CPU提升", rarity: "普通", pixelCost: 10, effect: "1小时内CPU上限+10" },
        { name: "建筑加速卡", rarity: "稀有", pixelCost: 10, effect: "10分钟内建造速度×2" },
        { name: "能量采集加成", rarity: "史诗", pixelCost: 10, effect: "2小时内能量采集+20%" },
        { name: "房间扩容卡", rarity: "传说", pixelCost: 10, effect: "永久解锁1个额外房间上限" }
    ];

    // 3. 执行抽卡（按概率随机）
    const rewards = [];
    for (let i = 0; i < count; i++) {
        // 定义概率权重：普通80%、稀有15%、史诗4%、传说1%
        const random = Math.random();
        let reward;
        if (random < 0.8) {
            reward = rewardPool[0];
        } else if (random < 0.95) {
            reward = rewardPool[1];
        } else if (random < 0.99) {
            reward = rewardPool[2];
        } else {
            reward = rewardPool[3];
        }
        rewards.push(reward);
    }

    // 4. 模拟消耗Pixel（实际需调用官方商店API）
    // 注意：真实抽卡需通过Screeps官网商店，游戏内API仅用于生成Pixel，不直接扣减
    // 此处仅为模拟，实际扣减需手动操作或通过官方API（需认证）
    return `抽卡${count}次成功！消耗${cost}Pixel，获得奖励：\n` + 
           rewards.map((r, idx) => `${idx+1}. ${r.rarity} - ${r.name}（${r.effect}）`).join("\n");
}

/* ================= ROLE CACHE ================= */
function buildRoleCache() {
    RoleCache = {};
    for (let name in Game.creeps) {
        const creep = Game.creeps[name];
        if (!RoleCache[creep.memory.role]) {
            RoleCache[creep.memory.role] = [];
        }
        RoleCache[creep.memory.role].push(creep);
    }
}

/* ================= EMERGENCY ================= */
function checkEmergencyMode(room) {
    if (!Memory.roomEmergency) Memory.roomEmergency = {};

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) {
        Memory.roomEmergency[room.name] = true;
        return;
    }

    const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_EXTENSION
    });

    // 计算总可用能量
    const totalEnergy = spawn.store[RESOURCE_ENERGY] + 
                       extensions.reduce((sum, e) => sum + (e.store[RESOURCE_ENERGY] || 0), 0);
    
    // 结合storage能量判断应急模式
    const storageEnergy = room.storage ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0;
    Memory.roomEmergency[room.name] = (totalEnergy < EMERGENCY_ENERGY_LIMIT && storageEnergy < 1000);
}

/* ================= LOCAL ECONOMY ================= */
function runLocalEconomy(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) return;

    const isEmergency = Memory.roomEmergency[room.name];
    const roomEnergy = room.energyAvailable;

    // 1. 优先孵化防御者（有敌人时，每个房间自己孵化）
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const defenders = RoleCache["defender_" + room.name] || []; // 按房间区分防御者
    if ((hostiles.length > 0 || Memory.warMode) && defenders.length < 1) {
        spawnCreepSafe(spawn, "defender", room.name, isEmergency);
        return;
    }

    // 2. 孵化基础矿工（每个source 1个miner，每个房间自己孵化）
    const miners = RoleCache["miner_" + room.name] || []; // 按房间区分矿工
    const sourceCount = room.find(FIND_SOURCES).length;
    if (miners.length < sourceCount * 1) {
        spawnCreepSafe(spawn, "miner", room.name, isEmergency);
        return;
    }

    // 3. 孵化Z矿矿工（仅当Z矿可开采时，每个房间自己孵化）
    const minersZ = RoleCache["minerZ_" + room.name] || []; // 按房间区分Z矿矿工
    const minerals = room.find(FIND_MINERALS);
    const hasMineral = minerals.length > 0;
    const isMineralAvailable = hasMineral && 
                              minerals[0].mineralAmount > 0 && 
                              minerals[0].cooldown === 0;

    if (hasMineral && isMineralAvailable && minersZ.length < 1 && !isEmergency) {
        spawnCreepSafe(spawn, "minerZ", room.name, isEmergency);
        return;
    }

    // 4. 孵化搬运工（每个房间自己孵化）
    const haulers = RoleCache["hauler_" + room.name] || []; // 按房间区分搬运工
    if (haulers.length < 1) {
        spawnCreepSafe(spawn, "hauler", room.name, isEmergency);
        return;
    }

    // 5. 孵化升级worker（每个房间自己孵化）
    const upgraderWorkers = RoleCache["worker_upgrader_" + room.name] || []; // 按房间区分升级工
    if (!isEmergency && upgraderWorkers.length < 1) {
        spawnCreepSafe(spawn, "worker_upgrader", room.name, isEmergency);
        return;
    }

    // 6. 孵化建造维修worker（每个房间自己孵化）
    const builderWorkers = RoleCache["worker_builder_" + room.name] || []; // 按房间区分建造工
    if (!isEmergency && builderWorkers.length < 1) {
        spawnCreepSafe(spawn, "worker_builder", room.name, isEmergency);
        return;
    }

    // 7. 孵化扩张用worker（仅主房间孵化，用于新的待占领房间）
    if (!isEmergency && room.name === MAIN_ROOM) {
        const expandWorkers = RoleCache["worker_expand"] || [];
        if (expandWorkers.length < 2) {
            for (let targetRoom of CLAIM_ROOMS) {
                const target = Game.rooms[targetRoom];
                // 仅当目标房间已占领但还没自己的Spawn时，才孵化expand worker
                if (target && target.controller && target.controller.my && target.find(FIND_MY_SPAWNS).length === 0) {
                    spawnCreepSafe(spawn, "worker_expand", targetRoom, isEmergency);
                    break;
                }
            }
        }
    }

    // 8. 孵化殖民者（仅主房间孵化，用于未占领房间）
    if (!isEmergency && room.name === MAIN_ROOM) {
        const colonizers = RoleCache["colonizer"] || [];
        if (colonizers.length < 1) {
            for (let targetRoom of CLAIM_ROOMS) {
                const target = Game.rooms[targetRoom];
                if (!target || !target.controller || !target.controller.my) {
                    spawnCreepSafe(spawn, "colonizer", targetRoom, isEmergency);
                    break;
                }
            }
        }
    }
}

/* ================= REMOTE SYSTEM ================= */
// 初始化远程房间配置（仅主房间执行）
function initRemoteRooms() {
    const mainRoom = Game.rooms[MAIN_ROOM];
    if (!mainRoom || !mainRoom.controller || !mainRoom.controller.my) return;

    if (!mainRoom.memory.remotes) mainRoom.memory.remotes = {};

    // 配置远程房间
    for (let remoteName of RESERVE_ROOMS) {
        if (!mainRoom.memory.remotes[remoteName]) {
            mainRoom.memory.remotes[remoteName] = {
                active: true,
                profit: 0
            };
        }
    }
}

function runRemoteSystem(room) {
    if (!room.memory.remotes) return;

    for (let remoteName in room.memory.remotes) {
        const remoteData = room.memory.remotes[remoteName];
        const remoteRoom = Game.rooms[remoteName];

        // 威胁检测
        if (remoteRoom) {
            const hostile = remoteRoom.find(FIND_HOSTILE_CREEPS);
            if (hostile.length > 0) {
                remoteData.active = false;
                continue;
            }
        }

        // 收益估算（简化版）
        const miners = (RoleCache[`remoteMiner_${remoteName}`] || []).length;
        const haulers = (RoleCache[`remoteHauler_${remoteName}`] || []).length;
        const reservers = (RoleCache[`reserver_${remoteName}`] || []).length;

        const income = miners * 3000;
        const cost = (miners * 550 + haulers * 800 + reservers * 600) / 1500 * 300;

        remoteData.profit = income - cost;
        remoteData.active = remoteData.profit > 0 && !Memory.roomEmergency[room.name];

        if (!remoteData.active) continue;

        spawnRemote(room, remoteName);
    }
}

function spawnRemote(homeRoom, remoteName) {
    const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) return;

    const isEmergency = Memory.roomEmergency[homeRoom.name];
    const miners = RoleCache[`remoteMiner_${remoteName}`] || [];
    const haulers = RoleCache[`remoteHauler_${remoteName}`] || [];
    const reservers = RoleCache[`reserver_${remoteName}`] || [];

    // 1. 孵化远程矿工
    if (miners.length < 2) {
        spawnCreepSafe(spawn, "remoteMiner", remoteName, isEmergency);
        return;
    }

    // 2. 孵化远程搬运工
    if (haulers.length < 2) {
        const distance = Game.map.getRoomLinearDistance(homeRoom.name, remoteName);
        let carryParts = isEmergency ? 2 : (6 + distance * 2);
        let body = [];

        for (let i = 0; i < carryParts; i++) body.push(CARRY);
        for (let i = 0; i < Math.ceil(carryParts / 2); i++) body.push(MOVE);

        spawn.spawnCreep(
            body,
            `remoteHauler_${remoteName}_${Game.time}`,
            { memory: { role: `remoteHauler_${remoteName}`, targetRoom: remoteName, home: homeRoom.name } }
        );
        return;
    }

    // 3. 孵化房间保留者
    if (reservers.length < 1) {
        spawnCreepSafe(spawn, "reserver", remoteName, isEmergency);
    }
}

/* ================= CREEP RUN ================= */
function runAllCreeps() {
    for (let name in Game.creeps) {
        const creep = Game.creeps[name];
        const role = creep.memory.role;

        // 应急模式下延长creep生命周期
        if (creep.ticksToLive < 50 && !["defender", "reserver"].includes(role.split("_")[0])) { // 适配带房间后缀的role
            if (creep.store.getUsedCapacity() > 0) {
                const tar = creep.room.storage || creep.room.find(FIND_MY_SPAWNS)[0] || creep.room.controller;
                if (tar) {
                    if (tar.structureType === STRUCTURE_CONTROLLER) {
                        creep.upgradeController(tar);
                    } else {
                        creep.transfer(tar, RESOURCE_ENERGY);
                    }
                }
            }
            // 应急模式下禁止自杀
            if (!Memory.roomEmergency[creep.room.name]) {
                creep.suicide();
            }
            continue;
        }

        // ========== 核心修改2：适配按房间区分的role，执行对应逻辑 ==========
        // 基础角色（带房间后缀）
        if (role.startsWith("miner_")) runMiner(creep);
        else if (role.startsWith("minerZ_")) runMinerZ(creep);
        else if (role.startsWith("hauler_")) runHauler(creep);
        else if (role.startsWith("defender_")) runDefender(creep);
        else if (role === "colonizer") runColonizer(creep);
        
        // Worker角色（分工，带房间后缀）
        else if (role.startsWith("worker_upgrader_")) runWorkerUpgrader(creep);
        else if (role.startsWith("worker_builder_")) runWorkerBuilder(creep);
        else if (role === "worker_expand") runWorkerExpand(creep);
        
        // 远程角色
        else if (role.startsWith("remoteMiner")) runRemoteMiner(creep);
        else if (role.startsWith("remoteHauler")) runRemoteHauler(creep);
        else if (role.startsWith("reserver")) runReserver(creep);
    }
}

// 本地矿工（动态双源负载均衡 + 满载才转移 + 修复-6错误）
function runMiner(creep) {
    // ========== 核心优化：动态选择最优能量源 ==========
    // 1. 筛选房间内所有可采集的能量源（排除冷却中的）
    const activeSources = creep.room.find(FIND_SOURCES_ACTIVE);
    if (activeSources.length === 0) {
        console.log(`[${creep.room.name}] 无可用能量源，矿工${creep.name}等待`);
        creep.moveTo(25, 25);
        return;
    }

    // 2. 计算每个能量源的负载（当前矿工数量），实现负载均衡
    const sourceWithLoad = activeSources.map(source => {
        // 统计当前在该能量源旁的矿工数量（范围2格内）
        const minersNearby = source.pos.findInRange(FIND_MY_CREEPS, 2, {
            filter: c => c.memory.role.startsWith("miner_") && c.name !== creep.name
        }).length;
        return {
            source: source,
            load: minersNearby,
            distance: creep.pos.getRangeTo(source) // 距离当前矿工的距离
        };
    });

    // 3. 排序选最优：负载低 → 距离近 → 优先选
    sourceWithLoad.sort((a, b) => {
        if (a.load !== b.load) return a.load - b.load; // 优先负载低的
        return a.distance - b.distance; // 负载相同选距离近的
    });
    const targetSource = sourceWithLoad[0].source; // 最优能量源

    // ========== 核心逻辑：满载转移，未满载采集 ==========
    const isFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;

    // 4. 背包满 → 转移能量（优先级：link > container > spawn/extension > storage）
    if (isFull) {
        const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                         s.pos.getRangeTo(targetSource) <= 5 &&
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        }) || creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER &&
                         s.pos.getRangeTo(targetSource) <= 5 &&
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        }) || creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        }) || (creep.room.storage ? creep.room.storage : null);

        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 30, range: 1 });
            }
            return;
        }
    }

    // 5. 背包未满 → 采集最优能量源（避免-6错误）
    if (targetSource.energy > 0) { // 再次确认能量源可采集
        const harvestResult = creep.harvest(targetSource);
        if (harvestResult === ERR_NOT_IN_RANGE) {
            creep.moveTo(targetSource, { reusePath: 30, range: 1 });
        } else if (harvestResult !== OK && harvestResult !== ERR_NOT_IN_RANGE) {
            // 仅打印非冷却类错误（-6是正常冷却，无需打印）
            console.log(`[${creep.name}] 采集${targetSource.id}失败: ${harvestResult}`);
        }
    } else {
        // 极端情况：能量源突然冷却，移动到旁等待
        creep.moveTo(targetSource, { reusePath: 30, range: 1 });
    }
}

// Z矿采集与存储（优先存Storage优化版）
function runMinerZ(creep) {
    const mineral = creep.room.find(FIND_MINERALS)[0];
    if (!mineral || mineral.mineralAmount === 0) {
        creep.moveTo(25, 25);
        return;
    }

    if (creep.store.getFreeCapacity() > 0) {
        if (creep.harvest(mineral) === ERR_NOT_IN_RANGE) {
            creep.moveTo(mineral, { reusePath: 30 });
        }
    } else {
        // ========== 核心修改：新增Storage作为Z矿存储优先级 ==========
        // 存储优先级：terminal > lab > storage
        const target = creep.room.terminal ||
                       creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                           filter: s => s.structureType === STRUCTURE_LAB &&
                                        s.store.getFreeCapacity(mineral.mineralType) > 0
                       }) || (creep.room.storage ? creep.room.storage : null);

        if (target) {
            if (creep.transfer(target, mineral.mineralType) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 30 });
            }
        }
    }
}

// 本地搬运工（优先存Storage优化版）
function runHauler(creep) {
    const isEmergency = Memory.roomEmergency[creep.room.name];
    const hasEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;

    if (!hasEnergy) {
        // 取能优先级：spawn旁link > 掉落物 > 容器 > storage
        const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                         s.pos.findInRange(FIND_MY_SPAWNS, 5).length > 0 &&
                         s.store[RESOURCE_ENERGY] > 0
        }) || creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > (isEmergency ? 20 : 50)
        }) || creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > (isEmergency ? 50 : 100)
        }) || (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 100 ? creep.room.storage : null);

        if (target) {
            if (target.structureType === STRUCTURE_LINK) {
                if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 20 });
                }
            } else if (target.resourceType) {
                if (creep.pickup(target) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 20 });
                }
            } else {
                if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 20 });
                }
            }
        }
    } else {
        // ========== 核心修改：调整送能优先级 ==========
        // 1. 优先填充spawn/extension（生产必需）
        const essentialTargets = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        if (essentialTargets) {
            if (creep.transfer(essentialTargets, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(essentialTargets, { reusePath: 20 });
            }
            return;
        }

        // 2. 其次填充tower（防御/维修必需）
        const towerTargets = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER && 
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                         s.store[RESOURCE_ENERGY] < 800 // tower保留200余量即可
        });
        if (towerTargets) {
            if (creep.transfer(towerTargets, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(towerTargets, { reusePath: 20 });
            }
            return;
        }

        // 3. 剩余所有能量强制存入storage（核心修改）
        const storage = creep.room.storage;
        if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(storage, { reusePath: 20 });
            }
            return;
        }

        // 4. 仅当storage满了，才分流到terminal/lab（兜底）
        const fallbackTarget = (creep.room.terminal ? creep.room.terminal : null) ||
                               creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                                   filter: s => s.structureType === STRUCTURE_LAB && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                               });
        if (fallbackTarget) {
            if (creep.transfer(fallbackTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(fallbackTarget, { reusePath: 20 });
            }
        }
    }
}

// 防御者
function runDefender(creep) {
    const room = creep.room;
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const invaders = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_INVADER_CORE
    });

    if (hostiles.length > 0 || invaders.length > 0) {
        const target = hostiles[0] || invaders[0];
        
        if (creep.pos.getRangeTo(target) > 3) {
            creep.rangedAttack(target);
            creep.moveTo(target, { reusePath: 10, range: 3 });
        } else if (creep.pos.getRangeTo(target) === 3) {
            creep.rangedAttack(target);
        } else {
            creep.moveTo(creep.pos.findClosestByPath(room.find(FIND_EXIT)), { reusePath: 10 });
        }
    } else {
        // 无敌人时巡逻
        creep.moveTo(25, 25, { reusePath: 50 });
    }
}

// 殖民者（完善的占领逻辑）
function runColonizer(creep) {
    const targetRoom = creep.memory.targetRoom || CLAIM_ROOMS[0];
    
    // 移动到目标房间
    if (creep.room.name !== targetRoom) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50 });
        return;
    }

    const ctrl = creep.room.controller;
    if (!ctrl) return;

    // 占领控制器
    if (!ctrl.my) {
        // 先攻击敌对reservation
        if (ctrl.reservation && ctrl.reservation.username !== creep.owner.username) {
            if (creep.attackController(ctrl) === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl);
            }
            return;
        }
        
        // 占领控制器
        const claimResult = creep.claimController(ctrl);
        if (claimResult === ERR_NOT_IN_RANGE) {
            creep.moveTo(ctrl);
        } else if (claimResult === ERR_GCL_NOT_ENOUGH) {
            // GCL不足时先reserve
            if (creep.reserveController(ctrl) === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl);
            }
        }
        return;
    }

    // 升级控制器到level 1
    if (ctrl.level < 1) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            const source = creep.room.find(FIND_SOURCES)[0];
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source);
            }
        } else {
            if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl);
            }
        }
        return;
    }

    // 建造基础Spawn
    const spawns = creep.room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0) {
        const spawnSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
            filter: s => s.structureType === STRUCTURE_SPAWN
        });

        if (spawnSites.length === 0) {
            // 寻找合适位置建造Spawn（避开墙，靠近controller）
            for (let dx = -3; dx <= 3; dx++) {
                for (let dy = -3; dy <= 3; dy++) {
                    const pos = new RoomPosition(ctrl.pos.x + dx, ctrl.pos.y + dy, creep.room.name);
                    if (pos.lookFor(LOOK_TERRAIN)[0] !== "wall") {
                        const createResult = pos.createConstructionSite(STRUCTURE_SPAWN);
                        if (createResult === OK) {
                            console.log(`[${creep.room.name}] 创建Spawn建造位点`);
                            break;
                        }
                    }
                }
            }
        } else {
            if (creep.build(spawnSites[0]) === ERR_NOT_IN_RANGE) {
                creep.moveTo(spawnSites[0], { reusePath: 20 });
            }
        }
    }

    // 补充能量
    if (creep.store[RESOURCE_ENERGY] === 0) {
        const source = creep.room.find(FIND_SOURCES)[0];
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source);
        }
    }
}

/* ================= ROLES - Worker角色（分工） ================= */
// 升级Worker（4个，优先取controller旁link）
function runWorkerUpgrader(creep) {
    const isEmergency = Memory.roomEmergency[creep.room.name];
    
    if (creep.store[RESOURCE_ENERGY] === 0) {
        // 优先级：controller旁link > container > storage > 自行采集
        let ctrlLink = null;
        if (creep.room.controller) {
            ctrlLink = creep.room.controller.pos.findInRange(FIND_MY_STRUCTURES, 5, {
                filter: s => s.structureType === STRUCTURE_LINK && s.store[RESOURCE_ENERGY] > 0
            })[0];
        }
        
        const target = ctrlLink || creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
        }) || (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 100 ? creep.room.storage : null);

        if (target) {
            if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 20 });
            }
        } else if (isEmergency) {
            const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { reusePath: 20 });
            }
        }
    } else {
        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(creep.room.controller, { range: 3, reusePath: 20 });
        }
    }
}

// 建造维修Worker（2个）
function runWorkerBuilder(creep) {
    const isEmergency = Memory.roomEmergency[creep.room.name];
    
    // 1. 优先建造建筑
    const constructionSites = creep.room.find(FIND_CONSTRUCTION_SITES);
    if (constructionSites.length > 0) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            // 取能逻辑
            const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
            }) || (creep.room.storage ? creep.room.storage : null);
            
            if (target) {
                if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 20 });
                }
            } else if (isEmergency) {
                const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
                if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(source);
                }
            }
        } else {
            const target = creep.pos.findClosestByPath(constructionSites);
            if (creep.build(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 20 });
            }
        }
        return;
    }

    // 2. 维修受损建筑
    const damagedStructures = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.hits < s.hitsMax * 0.9 &&
                     s.structureType !== STRUCTURE_WALL &&
                     s.structureType !== STRUCTURE_RAMPART
    });
    
    if (damagedStructures.length > 0) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
            }) || (creep.room.storage ? creep.room.storage : null);
            
            if (target) {
                if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 20 });
                }
            }
        } else {
            const target = creep.pos.findClosestByPath(damagedStructures);
            if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 20 });
            }
        }
        return;
    }

    // 3. 低优先级：维修墙和rampart
    const walls = creep.room.find(FIND_STRUCTURES, {
        filter: s => (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) &&
                     s.hits < WALL_REPAIR_LIMIT
    });
    
    if (walls.length > 0 && creep.store[RESOURCE_ENERGY] > 0) {
        const target = creep.pos.findClosestByPath(walls);
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 20 });
        }
    } else if (creep.store[RESOURCE_ENERGY] === 0) {
        const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
        }) || (creep.room.storage ? creep.room.storage : null);
        
        if (target) {
            if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 20 });
            }
        }
    }
}

// 扩张Worker（新占领房间建造）- 优先建Spawn，再建其他建筑，最后升级
function runWorkerExpand(creep) {
    const targetRoom = creep.memory.targetRoom;
    if (!targetRoom) return;

    // 1. 移动到目标房间（优先级最高）
    if (creep.room.name !== targetRoom) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50 });
        creep.memory.working = false;
        return;
    }

    // 2. 检查房间是否已占领
    const ctrl = creep.room.controller;
    if (!ctrl || !ctrl.my) {
        creep.moveTo(25, 25);
        creep.memory.working = false;
        return;
    }

    // ========== 核心状态管理 ==========
    if (creep.memory.working === undefined) {
        creep.memory.working = false;
    }

    // 3. 采集阶段：强制采集到满
    if (!creep.memory.working) {
        const isEnergyFull = creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
        if (isEnergyFull) {
            creep.memory.working = true;
        } else {
            const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
            if (!source) return;
            const harvestResult = creep.harvest(source);
            if (harvestResult === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { reusePath: 20, range: 1 });
            }
            return;
        }
    }

    // 4. 工作阶段：优先建Spawn → 再建其他 → 最后升级
    if (creep.memory.working) {
        const isEnergyEmpty = creep.store[RESOURCE_ENERGY] === 0;
        if (isEnergyEmpty) {
            creep.memory.working = false;
            return;
        }

        // ========== 核心新增：Spawn建造逻辑（最高优先级） ==========
        let targetSite = null;
        // 步骤1：检查是否已有Spawn（避免重复创建）
        const existingSpawns = creep.room.find(FIND_MY_SPAWNS);
        // 步骤2：检查是否已有Spawn建造位点
        const spawnSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
            filter: s => s.structureType === STRUCTURE_SPAWN
        });

        // 只有「无Spawn + 无Spawn建造位点 + 控制器等级≥2」才创建Spawn（等级2解锁Spawn）
        if (existingSpawns.length === 0 && spawnSites.length === 0 && ctrl.level >= 2) {
            // 找Spawn的最优建造位置（房间中心25,25附近，避开墙/其他建筑）
            const spawnPos = findOptimalSpawnPosition(creep.room);
            if (spawnPos) {
                const createResult = spawnPos.createConstructionSite(STRUCTURE_SPAWN);
                if (createResult === OK) {
                    console.log(`[${creep.room.name}] 创建Spawn建造位点：${spawnPos.x},${spawnPos.y}`);
                    // 找到刚创建的Spawn位点
                    const newSpawnSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
                        filter: s => s.structureType === STRUCTURE_SPAWN
                    });
                    if (newSpawnSites.length > 0) {
                        targetSite = newSpawnSites[0];
                    }
                } else {
                    console.log(`[${creep.room.name}] 创建Spawn失败：${createResult}`);
                }
            }
        } else if (spawnSites.length > 0) {
            // 已有Spawn建造位点，优先建造
            targetSite = creep.pos.findClosestByPath(spawnSites);
        }

        // ========== 原有建筑建造逻辑（Spawn之后） ==========
        if (!targetSite) {
            const buildOrder = [STRUCTURE_EXTENSION, STRUCTURE_ROAD, STRUCTURE_CONTAINER, STRUCTURE_TOWER, STRUCTURE_STORAGE];
            // 寻找已有建造位点
            for (let type of buildOrder) {
                const sites = creep.room.find(FIND_CONSTRUCTION_SITES, {
                    filter: s => s.structureType === type
                });
                if (sites.length > 0) {
                    targetSite = creep.pos.findClosestByPath(sites);
                    break;
                }
            }

            // 无位点则创建（优先Extension，且检查上限）
            if (!targetSite && ctrl.level >= 1) {
                const currentExtensions = creep.room.find(FIND_MY_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_EXTENSION
                }).length;
                const extensionLimits = {1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60};
                const maxExtensions = extensionLimits[ctrl.level] || 0;

                if (currentExtensions < maxExtensions) {
                    const spawnCenter = creep.room.find(FIND_MY_SPAWNS)[0] || {pos: new RoomPosition(25,25,creep.room.name)};
                    outerLoop:
                    for (let dx = -3; dx <= 3; dx++) {
                        for (let dy = -3; dy <= 3; dy++) {
                            const pos = new RoomPosition(spawnCenter.pos.x + dx, spawnCenter.pos.y + dy, creep.room.name);
                            const terrain = pos.lookFor(LOOK_TERRAIN)[0];
                            const structures = pos.lookFor(LOOK_STRUCTURES);
                            const existingSites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
                            if (terrain !== "wall" && structures.length === 0 && existingSites.length === 0) {
                                const createResult = pos.createConstructionSite(STRUCTURE_EXTENSION);
                                if (createResult === OK) {
                                    const newSites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
                                    if (newSites.length > 0) {
                                        targetSite = Game.getObjectById(newSites[0].id);
                                    }
                                    break outerLoop;
                                }
                            }
                        }
                    }
                }

                // 创建Road（仅1个位点）
                if (!targetSite) {
                    const sources = creep.room.find(FIND_SOURCES);
                    const spawns = creep.room.find(FIND_MY_SPAWNS);
                    const spawnCenter = spawns[0] || {pos: new RoomPosition(25,25,creep.room.name)};
                    if (sources.length > 0) {
                        const roomObj = Game.rooms[creep.room.name];
                        const roomTerrain = roomObj ? roomObj.getTerrain() : null;
                        const path = PathFinder.search(
                            sources[0].pos,
                            { pos: spawnCenter.pos, range: 1 },
                            { roomCallback: () => roomTerrain }
                        );
                        
                        let roadCreated = false;
                        for (let step of path.path) {
                            const pos = new RoomPosition(step.x, step.y, creep.room.name);
                            const hasSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0;
                            const hasStruct = pos.lookFor(LOOK_STRUCTURES).length > 0;
                            if (!hasSite && !hasStruct && !roadCreated) {
                                pos.createConstructionSite(STRUCTURE_ROAD);
                                roadCreated = true;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // ========== 执行建造/升级 ==========
        if (targetSite) {
            const buildResult = creep.build(targetSite);
            if (buildResult === ERR_NOT_IN_RANGE) {
                creep.moveTo(targetSite, { reusePath: 20, range: 3 });
            }
        } else {
            // 无建造任务时，升级控制器
            const upgradeResult = creep.upgradeController(ctrl);
            if (upgradeResult === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl, { reusePath: 20, range: 3 });
            }
        }
    }
}

// 辅助函数：寻找Spawn的最优建造位置（房间中心，避开墙/建筑）
function findOptimalSpawnPosition(room) {
    // 从房间中心25,25向外扩散找空位
    for (let r = 0; r <= 5; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (dx === -r || dx === r || dy === -r || dy === r) {
                    const x = 25 + dx;
                    const y = 25 + dy;
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                    const pos = new RoomPosition(x, y, room.name);
                    const terrain = pos.lookFor(LOOK_TERRAIN)[0];
                    const structures = pos.lookFor(LOOK_STRUCTURES);
                    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
                    // 条件：不是墙 + 无建筑 + 无建造位点
                    if (terrain !== "wall" && structures.length === 0 && sites.length === 0) {
                        return pos;
                    }
                }
            }
        }
    }
    return null;
}

/* ================= ROLES - 远程角色 ================= */
// 远程矿工
function runRemoteMiner(creep) {
    // 移动到目标房间
    const targetRoom = creep.memory.targetRoom;
    if (creep.room.name !== targetRoom) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50 });
        return;
    }

    // 采集能量
    const source = creep.pos.findClosestByPath(FIND_SOURCES);
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 30, range: 1 });
    }
}

// 远程搬运工
function runRemoteHauler(creep) {
    const hasEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    const targetRoom = creep.memory.targetRoom;
    const homeRoom = Game.rooms[creep.memory.home] || Game.rooms[MAIN_ROOM];

    if (!hasEnergy) {
        // 前往远程房间取能
        if (creep.room.name !== targetRoom) {
            creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50 });
            return;
        }

        const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0
        });

        if (container) {
            if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(container, { reusePath: 20 });
            }
        }
    } else {
        // 返回主房间送能
        if (!homeRoom || creep.room.name !== homeRoom.name) {
            creep.moveTo(new RoomPosition(25, 25, homeRoom.name), { reusePath: 50 });
            return;
        }

        const target = homeRoom.storage || homeRoom.find(FIND_MY_SPAWNS)[0];
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 20 });
            }
        }
    }
}

// 房间保留者
function runReserver(creep) {
    const targetRoom = creep.memory.targetRoom;
    
    // 移动到目标房间
    if (creep.room.name !== targetRoom) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 100, visualizePathStyle: { stroke: '#ffff00' } });
        return;
    }

    const ctrl = creep.room.controller;
    if (!ctrl) return;

    // 保留控制器
    if (!ctrl.reservation || ctrl.reservation.username !== creep.owner.username) {
        if (creep.reserveController(ctrl) === ERR_NOT_IN_RANGE) {
            creep.moveTo(ctrl);
        }
        return;
    }

    // 续期保留
    if (ctrl.reservation.ticksToEnd < 4000) {
        if (creep.reserveController(ctrl) === ERR_NOT_IN_RANGE) {
            creep.moveTo(ctrl);
        }
    }
}

/* ================= 辅助函数 ================= */
// 安全孵化Creep
function spawnCreepSafe(spawn, role, targetRoom, isEmergency) {
    if (!spawn) return false; // 空值保护
    
    const room = spawn.room;
    const creepName = `${role}_${targetRoom}_${Game.time}`;
    let body = getCreepBody(role, room.energyCapacityAvailable, room.energyAvailable, isEmergency);

    // 检查能量是否足够
    const bodyCost = calculateBodyCost(body);
    if (bodyCost > room.energyAvailable) {
        body = getMinimalCreepBody(role);
    }

    // ========== 核心修改3：给基础角色添加房间后缀，区分不同房间的creep ==========
    let memoryRole = role;
    // 基础角色（miner/hauler/defender等）添加房间后缀
    if (["miner", "minerZ", "hauler", "defender", "worker_upgrader", "worker_builder"].includes(role)) {
        memoryRole = `${role}_${room.name}`; // 用孵化房间作为后缀，而非targetRoom
    } else if (role === "remoteMiner") {
        memoryRole = `remoteMiner_${targetRoom}`;
    } else if (role === "reserver") {
        memoryRole = `reserver_${targetRoom}`;
    }

    const memory = {
        role: memoryRole,
        targetRoom: targetRoom,
        home: room.name
    };

    const result = spawn.spawnCreep(body, creepName, { memory: memory });
    if (result === OK) {
        console.log(`[${room.name}] 孵化${role}到${targetRoom}: ${creepName}`);
        return true;
    } else {
        console.log(`[${room.name}] 孵化${role}失败: ${result}`);
        return false;
    }
}

// 获取Creep身体配置
function getCreepBody(role, cap, availableEnergy, isEmergency) {
    if (isEmergency) return getMinimalCreepBody(role);

    switch (role) {
        case "miner":
            return cap >= 1200 ? [WORK, WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE] : [WORK, WORK, CARRY, MOVE];
        case "minerZ":
            return cap >= 1200 ? [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE] : [WORK, WORK, CARRY, MOVE];
        case "hauler":
            return cap >= 800 ? [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE] : [CARRY, CARRY, CARRY, MOVE, MOVE];
        case "worker_upgrader":
            return cap >= 1000 ? [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE] : [WORK, WORK, CARRY, MOVE];
        case "worker_builder":
            return cap >= 1000 ? [WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE] : [WORK, CARRY, MOVE];
        case "worker_expand":
            return cap >= 1000 ? [WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE] : [WORK, CARRY, MOVE];
        case "defender":
            return cap >= 800 ? [TOUGH, RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE] : [TOUGH, RANGED_ATTACK, MOVE];
        case "reserver":
            return cap >= 1300 ? [CLAIM, CLAIM, MOVE, MOVE] : [CLAIM, MOVE];
        case "colonizer":
            return cap >= 800 ? [CLAIM, WORK, CARRY, MOVE, MOVE] : [CLAIM, WORK, CARRY, MOVE];
        case "remoteMiner":
            return cap >= 1200 ? [WORK, WORK, WORK, CARRY, MOVE, MOVE] : [WORK, WORK, CARRY, MOVE];
        default:
            return [WORK, CARRY, MOVE];
    }
}

// 获取最小Creep身体配置
function getMinimalCreepBody(role) {
    switch (role) {
        case "miner": return [WORK, CARRY, MOVE];
        case "minerZ": return [WORK, CARRY, MOVE];
        case "hauler": return [CARRY, MOVE];
        case "worker_upgrader": return [WORK, CARRY, MOVE];
        case "worker_builder": return [WORK, CARRY, MOVE];
        case "worker_expand": return [WORK, CARRY, MOVE];
        case "defender": return [TOUGH, RANGED_ATTACK, MOVE];
        case "reserver": return [CLAIM, MOVE];
        case "colonizer": return [CLAIM, WORK, CARRY, MOVE];
        case "remoteMiner": return [WORK, CARRY, MOVE];
        default: return [WORK, CARRY, MOVE];
    }
}

// 计算身体部件成本
function calculateBodyCost(body) {
    return body.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}

/* ================= 房间设施逻辑 ================= */
// Tower逻辑（双塔协同）
function towerLogic(room) {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER
    });

    towers.forEach(t => {
        if (t.store[RESOURCE_ENERGY] < 100) return;

        // 1. 攻击入侵者
        const hostile = t.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (hostile) {
            t.attack(hostile);
            return;
        }

        const invaderCore = t.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_INVADER_CORE
        });
        if (invaderCore) {
            t.attack(invaderCore);
            return;
        }

        // 2. 医疗受伤creep
        const injuredCreep = t.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: c => c.hits < c.hitsMax
        });
        if (injuredCreep) {
            t.heal(injuredCreep);
            if (t.pos.getRangeTo(injuredCreep) > 3) {
                t.rangedHeal(injuredCreep);
            }
            return;
        }

        // 3. 修复关键设施
        const criticalRepair = t.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * 0.8
        });
        if (criticalRepair) {
            t.repair(criticalRepair);
            return;
        }

        // 4. 修复墙和 rampart
        const wallRepair = t.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) &&
                         s.hits < WALL_REPAIR_LIMIT
        });
        if (wallRepair) {
            t.repair(wallRepair);
        }
    });
}

// Link逻辑（均衡版：保底+交替分配，兼顾升级和生产）
function linkLogic(room) {
    const links = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK
    });
    if (links.length < 2) return; // 至少2个Link才执行

    // 1. 精准识别各功能Link
    const sourceLink = links.find(l => l.pos.findInRange(FIND_SOURCES, 3).length > 0);
    const spawnLink = links.find(l => l.pos.findInRange(FIND_MY_SPAWNS, 3).length > 0);
    const ctrlLink = room.controller ? links.find(l => l.pos.inRangeTo(room.controller, 3)) : null;

    // 调试日志：每100tick打印Link状态
    if (Game.time % 100 === 0) {
        console.log(`[${room.name}] Link状态：`);
        console.log(`- SourceLink: ${sourceLink ? `${sourceLink.id} (${sourceLink.store[RESOURCE_ENERGY]}能量)` : '未找到'}`);
        console.log(`- SpawnLink: ${spawnLink ? `${spawnLink.id} (${spawnLink.store[RESOURCE_ENERGY]}能量)` : '未找到'}`);
        console.log(`- CtrlLink: ${ctrlLink ? `${ctrlLink.id} (${ctrlLink.store[RESOURCE_ENERGY]}能量)` : '未找到'}`);
    }

    // 核心防护：SourceLink不可用则返回（原生冷却判断，不手动改）
    if (!sourceLink || sourceLink.cooldown > 0 || sourceLink.store[RESOURCE_ENERGY] < 200) {
        return;
    }

    // 配置参数（可根据需求调整）
    const BASE_CTRL_MIN = 200;    // Controller Link保底能量
    const CTRL_SAFE_LIMIT = 600;  // Controller Link安全阈值（补到这个值）
    const SPAWN_SAFE_LIMIT = 400;// Spawn Link安全阈值（补到这个值）
    const MAX_TRANSFER = 800;     // 单次最大传输量（Link单次最多传800）

    const sourceEnergy = sourceLink.store[RESOURCE_ENERGY];
    let transferTarget = null;
    let transferAmount = 0;

    // 2. 第一步：优先补Controller Link的保底（必须保证）
    if (ctrlLink && ctrlLink.id !== sourceLink.id) {
        const ctrlCurrent = ctrlLink.store[RESOURCE_ENERGY];
        // 如果Controller Link能量低于保底，先补到保底
        if (ctrlCurrent < BASE_CTRL_MIN) {
            transferAmount = Math.min(BASE_CTRL_MIN - ctrlCurrent, sourceEnergy, MAX_TRANSFER);
            transferTarget = ctrlLink;
        }
    }

    // 3. 第二步：剩余能量交替分配（谁缺补谁）
    if (!transferTarget && sourceEnergy > 400) {
        // 收集需要补充的Link（低于安全阈值）
        const needSupplement = [];
        if (ctrlLink && ctrlLink.id !== sourceLink.id && ctrlLink.store[RESOURCE_ENERGY] < CTRL_SAFE_LIMIT) {
            needSupplement.push({ link: ctrlLink, need: CTRL_SAFE_LIMIT - ctrlLink.store[RESOURCE_ENERGY] });
        }
        if (spawnLink && spawnLink.id !== sourceLink.id && spawnLink.store[RESOURCE_ENERGY] < SPAWN_SAFE_LIMIT) {
            needSupplement.push({ link: spawnLink, need: SPAWN_SAFE_LIMIT - spawnLink.store[RESOURCE_ENERGY] });
        }

        if (needSupplement.length > 0) {
            // 策略1：按「缺额比例」分配（优先补缺口大的）
            needSupplement.sort((a, b) => {
                const aRatio = a.need / CTRL_SAFE_LIMIT;
                const bRatio = b.need / SPAWN_SAFE_LIMIT;
                return bRatio - aRatio;
            });
            transferTarget = needSupplement[0].link;
            // 计算传输量：补到安全阈值 或 单次最大量 或 剩余能量，取最小值
            transferAmount = Math.min(needSupplement[0].need, sourceEnergy - BASE_CTRL_MIN, MAX_TRANSFER);
        }
    }

    // 4. 第三步：执行传输（如果有目标）
    if (transferTarget && transferAmount > 0) {
        const result = sourceLink.transferEnergy(transferTarget, transferAmount);
        if (result === OK) {
            console.log(`[${room.name}] Link传输：${transferAmount}能量 → ${transferTarget === ctrlLink ? 'Controller Link' : 'Spawn Link'}`);
        } else if (result !== ERR_FULL) { // 排除「目标满了」的正常错误
            console.log(`[${room.name}] Link传输失败：${result}（目标：${transferTarget === ctrlLink ? 'Controller' : 'Spawn'}）`);
        }
    }

    // 5. 第四步：所有Link都满了，提示Hauler转移到Storage
    const storage = room.storage;
    if (storage && !transferTarget && sourceEnergy > 500) {
        console.log(`[${room.name}] Source Link剩余${sourceEnergy}能量，所有Link已满，Hauler转移到Storage`);
    }
}

// 市场贸易逻辑（Z矿出售/H矿购买）
function runMarket(room) {
    // 每50tick执行一次
    if (Game.time % 100 !== 0) return;
    if (!room.terminal || room.terminal.cooldown > 0) return;

    const ter = room.terminal;
    const zAmount = ter.store[RESOURCE_ZYNTHIUM] || 0;
    const hAmount = ter.store[RESOURCE_HYDROGEN] || 0;

    // 卖Z矿（保留2500作为库存）
    if (zAmount > 2500) {
        const orders = Game.market.getAllOrders({
            type: ORDER_BUY,
            resourceType: RESOURCE_ZYNTHIUM
        });
        if (orders.length > 0) {
            // 按价格从高到低排序
            orders.sort(function(a, b) {
                return b.price - a.price;
            });
            const bestOrder = orders[0];
            
            // 只接受高于市场价的订单（0.35/unit）
            if (bestOrder.price >= 0.35) {
                const freeCapacity = ter.store.getFreeCapacity();
                const dealAmount = Math.min(
                    zAmount - 2500,    // 保留库存
                    bestOrder.amount,    // 订单剩余量
                    1000,               // 单次交易上限
                    freeCapacity // terminal剩余容量
                );
                
                if (dealAmount > 0) {
                    const dealResult = Game.market.deal(bestOrder.id, dealAmount, room.name);
                    if (dealResult === OK) {
                        console.log(`[${room.name}] 卖出${dealAmount} Z矿，单价${bestOrder.price}`);
                    }
                }
            }
        }
    }

    // 买H矿（补充到5000）
    if (hAmount < 5000) {
        const orders = Game.market.getAllOrders({
            type: ORDER_SELL,
            resourceType: RESOURCE_HYDROGEN
        });
        if (orders.length > 0) {
            // 按价格从低到高排序
            orders.sort(function(a, b) {
                return a.price - b.price;
            });
            const bestOrder = orders[0];
            
            // 只接受低于市场价的订单（0.45/unit）
            if (bestOrder.price <= 0.45) {
                const freeCapacity = ter.store.getFreeCapacity();
                const dealAmount = Math.min(
                    5000 - hAmount,     // 需要补充的量
                    bestOrder.amount,    // 订单剩余量
                    1000,               // 单次交易上限
                    freeCapacity // terminal剩余容量
                );
                
                if (dealAmount > 0) {
                    const dealResult = Game.market.deal(bestOrder.id, dealAmount, room.name);
                    if (dealResult === OK) {
                        console.log(`[${room.name}] 买入${dealAmount} H矿，单价${bestOrder.price}`);
                    }
                }
            }
        }
    }
}
