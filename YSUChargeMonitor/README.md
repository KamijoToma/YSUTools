# YSUChargeMonitor - 我真的好想充电啊😭

你是否因为鸟大充电桩爆满而焦虑？

你是否为电车充电感到焦头烂额？

你是否在电车没电的时候特别窘迫？

**那本项目非常适合你！**

本项目——我真的好想充电啊😭，让你足不出户打开IM软件就能实时接收到充电桩空闲插座的变化情况！

只需要引用 `main.kt`，然后编写胶水代码连接到你的IM机器人，定时调用获取 `diff` 即可开始享用！

在使用之前，你可能需要从微信公众号中抓包 JWT 密钥，否则没有权限访问。好在密钥的有效期是一个月！

## 依赖

```kotlin
implementation("io.ktor:ktor-client-okhttp:2.3.4")
implementation("io.ktor:ktor-serialization-gson:2.3.4")
implementation("io.ktor:ktor-client-content-negotiation:2.3.4")
implementation("com.google.code.gson:gson:2.10.1")
implementation("io.ktor:ktor-client-okhttp-jvm:2.3.4")
```

## License

`MIT License`

就酱，我要去睡觉了，大家88