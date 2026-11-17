'use strict';
/**
 * 商品真实图片映射
 * ------------------------------------------------------------------
 * 素材中心 / 订单卡片需要「真实商品图」而不是渐变占位图。
 * 这里维护一份「关键词 → 真实商品照片 URL」的映射：
 *   1. 素材名（如「纯棉T恤-主图-01.jpg」）先精确匹配 MEDIA_PHOTOS；
 *   2. 否则按名称里的关键词模糊匹配 KEYWORD_PHOTOS；
 *   3. 再否则返回 ''，由调用方回落到占位图。
 * 照片存放在 public/uploads/products/，替换成自己的实拍图时
 * 直接覆盖同名文件即可，无需改代码。
 */
const PHOTO_DIR = '/uploads/products/';

/* 素材名精确映射（用于素材中心种子数据） */
const MEDIA_PHOTOS = {
  '纯棉T恤-主图-01.jpg': 'tshirt-main.png',
  '纯棉T恤-细节图-03.jpg': 'tshirt-detail.png',
  '保温杯-场景图-02.jpg': 'thermos-scene.png',
  '直播间赠品说明.png': 'gift-set.png',
  '运动鞋-开箱视频.mp4': 'sneakers.png',
};

/* 视频素材的真实文件映射 */
const MEDIA_VIDEOS = {
  '运动鞋-开箱视频.mp4': 'sneakers-unboxing.mp4',
};

/* 关键词模糊映射（用于订单卡片按商品名取图）—— 注意「开衫|毛衣|针织」要排在 T恤 之前 */
const KEYWORD_PHOTOS = [
  [/苹果|水果|富士|冰糖|果园/, 'apple.png'],
  [/开衫|毛衣|针织|外套|披肩|羊毛/, 'cardigan.png'],
  [/收纳箱|收纳架|收纳|整理箱|置物/, 'storage-box.png'],
  [/折叠凳|凳子|马扎|板凳|凳/, 'stool.png'],
  [/眼罩|真丝|睡眠|丝巾/, 'eye-mask.png'],
  [/运动鞋|跑鞋|休闲鞋|板鞋|老爹鞋|鞋/, 'sneakers.png'],
  [/T恤|短袖|卫衣|衬衫/, 'tshirt-main.png'],
  [/保温杯|水杯|保温壶|杯/, 'thermos-scene.png'],
  [/赠品|礼包|礼物|周边/, 'gift-set.png'],
];

/**
 * 按名称取真实商品图 URL
 * @param {string} name 素材名或商品名
 * @returns {string} 形如 /uploads/products/xxx.png，未命中返回 ''
 */
function productImage(name) {
  const key = String(name || '').trim();
  if (!key) return '';
  if (MEDIA_PHOTOS[key]) return PHOTO_DIR + MEDIA_PHOTOS[key];
  for (const [re, file] of KEYWORD_PHOTOS) {
    if (re.test(key)) return PHOTO_DIR + file;
  }
  return '';
}

/** 视频/其他无 content 素材的封面图 */
function posterFor(name) {
  return productImage(name);
}

/** 视频素材的真实可播放文件 URL，未命中返回 '' */
function videoFile(name) {
  const key = String(name || '').trim();
  return MEDIA_VIDEOS[key] ? '/uploads/' + MEDIA_VIDEOS[key] : '';
}

module.exports = { productImage, posterFor, videoFile, MEDIA_PHOTOS, PHOTO_DIR };
