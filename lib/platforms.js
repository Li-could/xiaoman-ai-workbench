'use strict';
/**
 * 电商平台清单（网页登录型 + 是否已接 API）
 *
 * loginUrl   —— 平台官方登录页（真实地址，用于内嵌/新窗口登录）
 * backendUrl —— 平台商家后台真实地址
 * api        —— 是否已经在本项目里完成开放平台 API 对接
 */
const PLATFORMS = [
  {
    key: 'douyin', name: '抖音飞鸽', short: '抖', color: '#161823',
    loginUrl: 'https://fxg.jinritemai.com/login/common',
    backendUrl: 'https://fxg.jinritemai.com/',
    api: false, apiNote: '需抖店开放平台应用 + IM 客服权限签约',
    embed: false, embedNote: '该平台禁止被其他站点内嵌（frame-ancestors），只能在新窗口/系统浏览器中登录操作',
  },
  {
    key: 'pdd', name: '拼多多', short: '拼', color: '#E02E24',
    loginUrl: 'https://mms.pinduoduo.com/login/',
    backendUrl: 'https://mms.pinduoduo.com/',
    api: false, apiNote: '需多多开放平台 ISV 授权',
    embed: false, embedNote: '该平台禁止被其他站点内嵌（frame-ancestors），只能在新窗口/系统浏览器中登录操作',
  },
  {
    key: 'kuaishou', name: '快手', short: '快', color: '#FF6600',
    loginUrl: 'https://s.kwaixiaodian.com/',
    backendUrl: 'https://s.kwaixiaodian.com/',
    api: false, apiNote: '需快手小店开放平台应用',
    embed: true, embedNote: '',
  },
  {
    key: 'jd', name: '京东', short: '京', color: '#E1251B',
    loginUrl: 'https://passport.jd.com/new/login.aspx',
    backendUrl: 'https://shop.jd.com/',
    api: false, apiNote: '需宙斯开放平台应用 + 咚咚客服权限',
    embed: false, embedNote: '京东商家后台禁止被内嵌（frame-ancestors / X-Frame-Options），只能在新窗口登录操作',
  },
  {
    key: 'channels', name: '视频号', short: '视', color: '#07C160',
    loginUrl: 'https://channels.weixin.qq.com/shop',
    backendUrl: 'https://channels.weixin.qq.com/shop',
    api: false, apiNote: '需微信小店开放接口权限',
    embed: true, embedNote: '',
  },
  {
    key: 'xhs', name: '小红书', short: '红', color: '#FF2442',
    loginUrl: 'https://ark.xiaohongshu.com/',
    backendUrl: 'https://ark.xiaohongshu.com/',
    api: false, apiNote: '需小红书千帆开放平台应用',
    embed: true, embedNote: '',
  },
  {
    key: 'hours', name: '小时达', short: '时', color: '#1D2129',
    loginUrl: 'https://daojia.jd.com/',
    backendUrl: 'https://daojia.jd.com/',
    api: false, apiNote: '京东到家商家后台',
    embed: true, embedNote: '',
  },
  {
    key: 'taobao', name: '淘宝', short: '淘', color: '#FF5000',
    loginUrl: 'https://login.taobao.com/member/login.jhtml',
    backendUrl: 'https://myseller.taobao.com/home.htm',
    api: true, apiNote: '已接入 TOP 开放平台：店铺信息 / 订单 / 退款 / 商品 / TMC 消息',
    embed: false, embedNote: '淘宝商家后台禁止被内嵌（frame-ancestors / X-Frame-Options），只能在新窗口/系统浏览器中登录操作',
  },
  {
    key: 'taofactory', name: '淘工厂', short: '厂', color: '#FF6A00',
    loginUrl: 'https://login.taobao.com/member/login.jhtml',
    backendUrl: 'https://myseller.taobao.com/home.htm',
    api: true, apiNote: '与淘宝共用 TOP 授权',
    embed: false, embedNote: '淘工厂与淘宝共用商家后台，后台禁止被内嵌（frame-ancestors），只能在新窗口登录操作',
  },
  {
    key: 'tmall', name: '天猫', short: '猫', color: '#FF0036',
    loginUrl: 'https://login.taobao.com/member/login.jhtml',
    backendUrl: 'https://myseller.taobao.com/home.htm',
    api: true, apiNote: '与淘宝共用 TOP 授权',
    embed: false, embedNote: '天猫与淘宝共用商家后台，后台禁止被内嵌（frame-ancestors），只能在新窗口登录操作',
  },
];

function get(key) {
  return PLATFORMS.find((p) => p.key === key) || null;
}

/** 平台名归一：'淘宝/天猫'、'天猫'、'taobao' 都归到 taobao */function normalize(name) {
  const s = String(name || '').trim().toLowerCase();
  const alias = {
    '淘宝/天猫': 'taobao', '淘宝': 'taobao', '天猫': 'tmall', 'taobao': 'taobao', 'tmall': 'tmall',
    '京东': 'jd', 'jd': 'jd', '拼多多': 'pdd', 'pdd': 'pdd', '抖音': 'douyin', '抖音飞鸽': 'douyin',
    'douyin': 'douyin', '快手': 'kuaishou', '小红书': 'xhs', '视频号': 'channels', '微信小店': 'channels',
    '小时达': 'hours', '淘工厂': 'taofactory', '自建站': 'custom',
  };
  return alias[s] || s;
}

module.exports = { PLATFORMS, get, normalize };
