# luci-app-fan-bpir4

LuCI fan control application for **Banana Pi BPI-R4** (MediaTek MT7988A / Filogic 880).

## Features

- **Real-time dashboard** — animated PC-style fan icon with PWM ring, per-core CPU frequency & usage, load averages, temperature for CPU/SoC and all three Wi-Fi chips, memory usage bar
- **Auto mode** — leverages the kernel `step_wise` thermal governor; configurable trip-point temperatures (low / medium / full speed)
- **Manual mode** — fixed PWM duty cycle with dead-zone warnings (start threshold 66/255, stop threshold 43/255) and quick preset buttons
- **Safe governor switching** — pre-sets the correct PWM based on current temperature before handing off to `step_wise`, preventing the fan from staying stopped after returning from manual mode
- **i18n** — English and Simplified Chinese (zh-cn / zh_Hans)

## Screenshot

![Dashboard](screenshots/dashboard.png)

## Requirements

- OpenWrt 23.05+ / ImmortalWrt 24.10+
- Target: `mediatek/filogic` (BPI-R4)
- Package dependencies: `luci`

## Installation

### Build from source

Place this package under `package/` in your OpenWrt build tree, then:

```bash
make menuconfig   # Network → Web Servers/Proxies → luci-app-fan-bpir4
make package/luci-app-fan-bpir4/compile V=s
```

### Install on device

```bash
opkg install luci-app-fan-bpir4_*.ipk
/etc/init.d/fan-bpir4 enable
/etc/init.d/fan-bpir4 start
```

## Configuration

UCI config is stored in `/etc/config/fan-bpir4`:

```
config fan-bpir4
    option mode        'auto'     # auto | manual
    option pwm         '128'      # manual mode PWM value (0-255)
    option temp_low    '40'       # °C, triggers state1 PWM=80  (31%)
    option temp_med    '85'       # °C, triggers state2 PWM=128 (50%)
    option temp_high   '115'      # °C, triggers state3 PWM=255 (100%)
```

## Fan Hardware Notes

Tested on BPI-R4 onboard fan (3-pin, no tach):

| PWM | Duty | Behavior |
|-----|------|----------|
| 0   | 0%   | Stopped |
| ≤ 43 | ≤ 17% | **Stop threshold** — fan stops even if spinning |
| 44–65 | 17–25% | **Dead zone** — cannot start from rest, sustains if already spinning |
| ≥ 66 | ≥ 26% | **Start threshold** — minimum PWM to start from rest |
| 255 | 100% | Full speed |

## License

GPL-2.0
