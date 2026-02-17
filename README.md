关键修复点说明

替换可选链语法：

错误代码：Game.getObjectById(SPAWN_LINK_POS.lookFor(LOOK_STRUCTURES)[0]?.id)

修复后：

javascript
运行

// 分步获取，ES5兼容写法

var spawnLinkStructures = SPAWN_LINK_POS.lookFor(LOOK_STRUCTURES);

var spawnLink = null;

if (spawnLinkStructures.length > 0) {

    spawnLink = Game.getObjectById(spawnLinkStructures[0].id);
    
}

同理修复了 CTRL_LINK_POS 处的可选链语法，确保所有操作都符合 ES5 规范。

核心逻辑不变：

保留了原有的优先级设计（指定 link 优先、阈值降低、蹲守逻辑）；

仅修改语法兼容部分，功能逻辑完全不变，确保解决你最初的资源取能问题。

验证方式

替换代码后，控制台不再出现 SyntaxError: Unexpected token . 错误；

运行后观察：

upgrader 优先从 controller 旁 link（5,6）取能，其次是 source 旁 container；

transporter 优先提取 spawn 旁 link（30,24）的能量，及时转移给核心建筑。

总结

语法修复：将 ES6+ 可选链 ?. 替换为 ES5 分步判断的写法，解决语法不兼容问题；

功能保留：完全保留原有的资源取能 / 转移优先级逻辑，确保解决你最初的业务问题；

ES5 规范：所有代码均符合 Screeps 运行环境的 ES5 语法要求，无其他隐藏语法错误。

替换后代码可直接运行，既解决了语法错误，又保留了修复后的业务逻辑，满足你的核心需求。








除了可选链操作符，还有哪些常见的语法问题可能导致类似错误？
如何在不修改代码的情况下，让 Screeps 运行环境支持可选链操作符？
除了可选链操作符，还有哪些 ES6+ 的新特性？
