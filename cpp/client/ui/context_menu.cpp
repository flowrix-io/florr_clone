#include "client/ui/context_menu.h"

#include <algorithm>

#include "client/ui/draw.h"
#include "client/ui/menu_style.h"
#include "client/ui/text.h"
#include "client/ui/text_select.h"

namespace flix::ui {

namespace {

constexpr double kRowHeight = 26.0;
constexpr double kPadX = 14.0;
constexpr double kPadY = 7.0;
constexpr double kMinWidth = 132.0;
constexpr double kTextSize = 13.0;
// gardn's panel edge, as every card wears it (panelCard): a rounded rect in
// the border colour with a square body dropped into it.
constexpr double kRadius = kMenuRadius;
constexpr double kBorder = 5.0;
constexpr double kDividerWidth = 2.0;
constexpr double kDividerInset = 6.0;

/// The shop BUTTON's green -- the stars icon in the top strip -- not the shop
/// card's, which is a duller shade of it. Both literals are that button's own
/// fill/border pair from MenuSystem::strip() in menus.cpp and have to stay in
/// step with it; the strip keeps its rows as one literal table, so there is
/// nowhere better for these two to live than beside the thing that borrows
/// them.
constexpr std::uint32_t kBody = 0x7EF16Bu;
constexpr std::uint32_t kFrame = 0x64C156u;
constexpr std::uint32_t kHover = lighten(kBody, 0.15);

/// How far a menu that would run off the screen is pulled back inside it.
constexpr double kScreenPad = 4.0;

} // namespace

void ContextMenu::open(Vec2 at, std::vector<Item> items, int viewWidth, int viewHeight) {
    items_ = std::move(items);
    if (items_.empty()) {
        close();
        return;
    }
    open_ = true;
    at_ = at;

    // Flipped rather than clamped when it would overflow: a menu shoved back
    // inside the edge covers the thing it was raised on, and the corner it
    // hangs from is the one piece of a context menu people aim at.
    const Rect card = bounds();
    if (card.right() > viewWidth - kScreenPad) at_.x = std::max(kScreenPad, at_.x - card.w);
    if (card.bottom() > viewHeight - kScreenPad) at_.y = std::max(kScreenPad, at_.y - card.h);
}

void ContextMenu::close() {
    open_ = false;
    items_.clear();
}

Rect ContextMenu::bounds() const {
    double width = kMinWidth;
    for (const Item& item : items_) {
        width = std::max(width, measure(item.label, kTextSize) + kPadX * 2);
    }
    return {at_.x, at_.y, width,
            kPadY * 2 + static_cast<double>(items_.size()) * kRowHeight};
}

bool ContextMenu::contains(Vec2 point) const {
    return open_ && bounds().contains(point);
}

ContextAction ContextMenu::update(Canvas& canvas, Window& window) {
    if (!open_) return ContextAction::None;
    if (window.keyPressed(Key::Escape)) {
        close();
        return ContextAction::None;
    }

    const Vec2 mouse{window.mouseX(), window.mouseY()};
    const Rect card = bounds();
    const bool inside = card.contains(mouse);
    // A press anywhere else dismisses. The frame asks `contains` first and
    // swallows that press, so it never also reaches the panel underneath.
    if (!inside && (window.mousePressed(MouseButton::Left) ||
                    window.mousePressed(MouseButton::Right))) {
        close();
        return ContextAction::None;
    }

    // The rows are painted here rather than in a separate pass: this card is
    // the last thing drawn in the frame, so there is nothing left for its own
    // hit test to be a frame behind.
    cardFrame(canvas, card, kBody, kFrame, kBorder, kRadius);
    if (inside) window.setCursorShape(CursorShape::Arrow);

    ContextAction chosen = ContextAction::None;
    double y = card.y + kPadY;
    for (const Item& item : items_) {
        const Rect row{card.x + kBorder, y, card.w - kBorder * 2, kRowHeight};
        const bool hovered = item.enabled && row.contains(mouse);
        if (hovered) {
            // Square, like the body it sits in.
            setFill(canvas, kHover);
            canvas.fillRect(static_cast<float>(row.x), static_cast<float>(row.y),
                            static_cast<float>(row.w), static_cast<float>(row.h));
        }
        // A disabled row is dimmed whole -- plate, label and outline -- rather
        // than recoloured, so it reads as the same row turned off.
        canvas.setGlobalAlpha(item.enabled ? 1.0f : 0.45f);

        TextStyle label;
        label.size = kTextSize;
        label.baseline = Baseline::Middle;
        label.fill = kPaper;
        label.stroke = kInk;
        label.roundJoin = true;
        // Not recorded as selectable: this card is chrome, and a menu whose own
        // labels could be dragged out would be selecting itself.
        TextCaptureScope off(false);
        text(canvas, item.label, row.x + kPadX, row.y + row.h * 0.5, label);

        canvas.setGlobalAlpha(1.0f);

        if (hovered && window.mousePressed(MouseButton::Left)) chosen = item.action;
        y += kRowHeight;
    }

    // Dividers between rows, in the rim's colour, over any hover wash so the
    // highlighted row keeps its edges. Inset from the sides so they read as
    // rules on the body rather than as the frame cutting through it.
    setFill(canvas, kFrame);
    for (std::size_t i = 1; i < items_.size(); ++i) {
        const double ruleY = card.y + kPadY + static_cast<double>(i) * kRowHeight;
        canvas.fillRect(static_cast<float>(card.x + kBorder + kDividerInset),
                        static_cast<float>(ruleY - kDividerWidth * 0.5),
                        static_cast<float>(card.w - (kBorder + kDividerInset) * 2),
                        static_cast<float>(kDividerWidth));
    }

    if (chosen != ContextAction::None) close();
    return chosen;
}

} // namespace flix::ui
