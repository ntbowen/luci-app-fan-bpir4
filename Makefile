include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Fan Control for BPI R4
LUCI_DEPENDS:=@TARGET_mediatek_filogic +luci
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-fan-bpir4
PKG_VERSION:=1.0
PKG_RELEASE:=1

include $(TOPDIR)/feeds/luci/luci.mk
# call BuildPackage - OpenWrt buildroot signature
