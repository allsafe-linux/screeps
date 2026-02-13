关键修改说明
Link 角色识别强化：增加了缺失 Link 时的日志提示，方便调试
传输辅助函数：封装transferEnergy函数，统一处理传输校验和数量计算
四级调度优先级：
优先保障 SpawnLink（核心设施）的能量需求
其次保障 ControllerLink（升级）的能量需求
然后平衡 SourceLink 的富余能量
最后平衡 SpawnLink 的富余能量
双向传输支持：不仅 SourceLink 可以向其他 Link 传输，其他 Link 之间也能互相补充（如 SpawnLink 富余时给 ControllerLink 传输）
最小传输量限制：避免小额、高频的无效传输，减少 Link 冷却浪费
总结
核心逻辑：3 个 Link 按 “核心设施优先→控制器升级优先→能量平衡” 的优先级实现双向智能传输，真正做到互通有无
关键配置：可通过调整SEND_THRESHOLD（发送阈值）、RECEIVE_THRESHOLD（接收阈值）、MIN_TRANSFER（最小传输量）适配不同房间需求
容错性：增加了 Link 缺失时的日志提示，避免代码报错，同时严格校验 Link 冷却状态，确保传输成功率
