# FreeNixxerByYourself

妈妈再也不用担心我的劳动时长不够辣

隆重向您介绍：劳动实践课程抢课小工具

自动检测新增劳动实践课程，过滤并自动报名，还可以在订阅后向主人发送通知。

## How to deploy?

⚠ 目前仅支持部署在校园网环境内（校园网、三大运营商宽带），不支持外部网络。

本脚本的功能仅包含单次检测，想要定时自动检测需要配合外部定时工具，例如 `cron`

启动所需环境变量：

```
PASSWORD # 账户密码
YESCAPTCHA_KEY # YesCaptcha (https://yescaptcha.com/) API Key，用于识别认证系统的图形验证码
USERNAME # 学号
```

然后配合定时工具每隔一段时间启动 `Auth.py` 即可，记得改一下通知方面的函数，好让它能真正通知到你！

还有还有，记得改一改活动过滤函数，过滤掉你不想报名的活动，比如小语种专属的图书馆书目标记！

常见的通知工具： ServerChan PushDeer

## Tech detail

主要由三部分组成：CAS密码加密工具、CAS认证工具、劳动教育平台解析工具

CAS模块是通用模块，可用于YSU校内所有利用CAS服务器进行认证的地方。 

最高级的API是 `login()` 函数，它利用环境变量中的账号信息进行登录，并返回一个包含cookie信息的 `requests.Session` 对象，
用户可利用该对象进行需要权限的API请求操作

`Encrypt.py` 中包含CAS服务器前端页面对密码进行加密的逻辑。由猫娘AI写作。

## License
```
GNU AGPLv3
```

就酱，我要去食堂吃饭了，大家88