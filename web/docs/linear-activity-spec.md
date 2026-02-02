# Linear Activity UI Specification

从 Linear app (https://linear.app) 通过 agent-browser 提取的精确 CSS 样式规范。

## Activity 区域整体结构

```
┌─────────────────────────────────────────────────────────────────┐
│ ─── 分割线 (1px solid #e8e8e8) ───                              │
├─────────────────────────────────────────────────────────────────┤
│ [Activity 标题]                        [Subscribe] [头像组]     │
├─────────────────────────────────────────────────────────────────┤
│ ○── [用户名] [动作描述] · [时间戳]     ← 简单事件 (无边框)      │
│ │                                                               │
│ ●── [用户名] [时间戳]                  ← 评论 (无独立边框)      │
│ │   [评论内容...]                                               │
│ │   [回复输入框...]                                             │
│ │                                                               │
│ ○── [用户名] [动作描述] · [时间戳]     ← 简单事件               │
└─────────────────────────────────────────────────────────────────┘

注意：○ = 图标/小头像  ● = 用户头像  │ = 时间轴线
```

## 关键发现

### 1. 评论有独立的卡片样式
- **边框**: 1px solid #e8e8e8 (lch 92)
- **圆角**: 8px
- **背景色**: #ffffff (白色)
- **阴影**: rgba(0,0,0,0.022) 0px 3px 6px -2px, rgba(0,0,0,0.044) 0px 1px 1px 0px
- **内边距**: 12px 16px

### 2. 时间轴线
- **存在**：在事件/评论之间有垂直连接线
- width: `1px`
- backgroundColor: `#c8c8c8` (lch 80-83)
- position: `absolute`
- 线条穿过图标/头像的中心

### 3. 头像
- 尺寸: `20x20px`
- border-radius: `50%` (圆形)
- object-fit: `cover`

### 4. 简单事件行布局

```
┌──────────────────────────────────────────────────────────────┐
│ [图标区]     [文本区]                                         │
│ 14x18px      flex: 1 1 auto                                  │
│ paddingTop:  fontSize: 12px                                  │
│ 2px          color: #5b5b5d                                  │
│              lineHeight: 16.8px                              │
│ marginRight:                                                  │
│ 11px                                                          │
└──────────────────────────────────────────────────────────────┘
```

样式：
```css
.event-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: normal;
  padding: 1px 0;
}

.event-icon-column {
  width: 14px;
  height: 18px;
  margin-right: 11px;
  padding-top: 2px;
}

.event-text-column {
  flex: 1 1 auto;
}
```

### 5. 事件文本样式

```css
.event-username {
  font-size: 12px;
  font-weight: 500;
  color: #5b5b5d;  /* lch(38.893) */
  text-decoration: none;
}

.event-action-text {
  font-size: 12px;
  font-weight: 400;
  color: #5b5b5d;
}

.event-separator {  /* · */
  font-size: 12px;
  color: #5b5b5d;
  margin: 0 4px;
}

.event-timestamp {
  font-size: 12px;
  font-weight: 400;
  color: #5b5b5d;
}
```

### 6. 评论布局

评论和简单事件是同级兄弟元素，使用相同的 Activity 容器：

```css
.activity-container {
  display: flex;
  flex-direction: column;
  gap: 18px;  /* 事件之间的间距 */
  position: relative;
}

.comment-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 12px 4px 6px;
  margin: 0 0 4px;
  /* position: sticky 用于固定头部 */
}

.comment-content {
  font-size: 15px;
  line-height: 22.5px;
  color: #1b1b1b;
}
```

### 7. 颜色规范 (HEX)

| 用途 | 颜色值 | LCH 值 |
|------|--------|--------|
| 主文本 | #1b1b1b | lch(9.723) |
| 次要文本/元数据 | #5b5b5d | lch(38.893) |
| 时间轴线 | #c8c8c8 | lch(80-83) |
| 边框 | #e8e8e8 | lch(92) |
| 页面背景 | #fdfdfd | lch(99) |

### 8. 页面级容器

整个页面有一个大的白色容器（MAIN 元素）：
- backgroundColor: `lch(99)` ≈ `#fdfdfd`
- border: `1px solid lch(87.817)` ≈ `#dcdcdc`
- borderRadius: `4px`
- boxShadow: `rgba(0,0,0,0.022) 0px 3px 6px -2px, rgba(0,0,0,0.044) 0px 1px 1px 0px`

但 **Activity 区域内的元素（评论、事件）都是透明的**，没有独立的卡片样式。

## 实现建议

### 正确的结构

```tsx
{/* Activity 容器 */}
<div className="flex flex-col gap-[18px] relative">
  
  {/* 时间轴线 - 绝对定位 */}
  <div className="absolute left-[7px] top-0 bottom-0 w-px bg-[#c8c8c8]" />
  
  {/* 简单事件 */}
  <div className="flex items-start">
    <div className="w-[14px] h-[18px] mr-[11px] pt-[2px] flex items-center justify-center relative z-10 bg-white">
      {/* 图标 */}
    </div>
    <span className="text-xs text-[#5b5b5d]">
      <b className="font-medium">wyatt</b> created the issue · 3mo ago
    </span>
  </div>
  
  {/* 评论 */}
  <div className="flex items-start">
    <div className="w-[20px] h-[20px] mr-[11px] rounded-[4px] overflow-hidden relative z-10">
      <img ... />
    </div>
    <div className="flex-1">
      {/* 评论头部 */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[15px] font-medium text-[#1b1b1b]">lu</span>
        <span className="text-[14px] text-[#5b5b5d]">3mo ago</span>
      </div>
      {/* 评论内容 - 无边框无背景 */}
      <div className="text-[15px] leading-[22.5px] text-[#1b1b1b]">
        {content}
      </div>
    </div>
  </div>
  
</div>
```

### 错误的做法（当前实现的问题）

1. ❌ 给评论添加白色卡片背景和边框
2. ❌ 使用圆形头像 (border-radius: 50%)
3. ❌ 缺少时间轴线
4. ❌ 头像放在卡片内部而不是外部
