#include "client/ui/menu_widgets.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <utility>

#include "svg.h"

#include "client/ui/text.h"
#include "client/ui/text_select.h"

namespace flix::ui {

namespace {

/// The gap the overlay panels leave between the bottom of the scrollbar track
/// and the bottom of the card. Mirrors menu_leaderboard.cpp's own constant;
/// scrollbar() needs it to recover the viewport height from the track.
constexpr double kTrackBottomInset = 5.0;

} // namespace

// ---------------------------------------------------------------------------
// Interactive chrome
// ---------------------------------------------------------------------------
//
// The card, its heading and every button live in client/ui/menu_style.h. What
// is left here is the chrome that carries state a panel has to feed it: a
// toggle's animation, a scrollbar's offset.

void toggleBox(Canvas& canvas, Rect r, double lerpAmount) {
    setFill(canvas, kControlDark);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                     static_cast<float>(r.h), 5.0f);
    canvas.fill();

    const double t = clamp(lerpAmount, 0.0, 1.0);
    const auto mix = [t](std::uint32_t shift) {
        const double off = static_cast<double>((kControlMid >> shift) & 0xFF);
        const double on = static_cast<double>((kControlLit >> shift) & 0xFF);
        return static_cast<std::uint32_t>(off + (on - off) * t + 0.5);
    };
    setFill(canvas, (mix(16) << 16) | (mix(8) << 8) | mix(0));
    const double inset = 4.0;
    canvas.fillRect(static_cast<float>(r.x + inset), static_cast<float>(r.y + inset),
                    static_cast<float>(r.w - inset * 2), static_cast<float>(r.h - inset * 2));
}

void scrollbar(Canvas& canvas, Rect view, double contentHeight, double scroll,
               std::uint32_t thumb, double width) {
    // The track stops 5px short of the panel's bottom edge, but the VIEWPORT
    // -- what decides both the thumb's length and how far it may travel -- is
    // the full body height. `view` is the track, so the viewport is 5px taller
    // than it; using the track for both makes the thumb short and leaves it a
    // pixel clear of the bottom at full scroll.
    const double viewport = view.h + kTrackBottomInset;
    if (contentHeight <= viewport || view.h <= 0) return;
    const double travel = contentHeight - viewport;
    // Proportional, and deliberately unfloored: the reference has no minimum,
    // and one would only bite on a list far longer than any panel shows.
    const double thumbHeight = view.h * (viewport / contentHeight);
    const double thumbY = view.y + clamp(scroll / travel, 0.0, 1.0) * (view.h - thumbHeight);
    // A 5px radius on the browser's 10px track: a full pill instead reads as
    // a different control at any other width.
    const double radius = std::min(5.0, width * 0.5);

    // A white track rather than a black one: it has to read on the saturated
    // panel colours, and a dark groove disappears into the settings grey.
    setFill(canvas, kPaper, 0.1);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(view.right() - width), static_cast<float>(view.y),
                     static_cast<float>(width), static_cast<float>(view.h),
                     static_cast<float>(radius));
    canvas.fill();

    setFill(canvas, thumb);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(view.right() - width), static_cast<float>(thumbY),
                     static_cast<float>(width), static_cast<float>(thumbHeight),
                     static_cast<float>(radius));
    canvas.fill();
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

namespace {

constexpr double kTooltipPadX = 10.0;
constexpr double kTooltipPadY = 8.0;
constexpr double kTooltipLineGap = 2.0;
constexpr double kTooltipRadius = 6.0;

/// Florr's petal header (client 0x10079f280): 16 px text, each piece in a box
/// as wide as its glyphs plus the outline pad, and a 15 px icon after it.
constexpr double kBadgeSize = 16.0;
constexpr double kBadgeIcon = 15.0;
/// Between the name and the header pieces. Ours: florr lays the two out with
/// its own widget tree, whose spacing was not read.
constexpr double kBadgeGap = 16.0;

/// The reload icon: florr's own path, a 512 box centred on (256, 256).
constexpr const char* kReloadIconPath =
    "M263.09 50c-11.882-.007-23.875 1.018-35.857 3.13C142.026 68.156 75.156 135.026 60.13 "
    "220.233 45.108 305.44 85.075 391.15 160.005 434.41c32.782 18.927 69.254 27.996 105.463 "
    "27.553 46.555-.57 92.675-16.865 129.957-48.15l-30.855-36.768c-50.95 42.75-122.968 "
    "49.05-180.566 15.797-57.597-33.254-88.152-98.777-76.603-164.274 11.55-65.497 62.672-116.62 "
    "128.17-128.168 51.656-9.108 103.323 7.98 139.17 43.862L327 192h128V64l-46.34 "
    "46.342C370.242 71.962 317.83 50.03 263.09 50z";

double rowHeight(double size) { return std::ceil(size * 1.2); }

/// florr's Text box pad, 2 * int(2 * size * outline ratio): the glyphs sit
/// centred in their advance plus this.
double badgePad() { return 2.0 * std::floor(2.0 * kBadgeSize * 0.12); }

double badgesWidth(const std::vector<TooltipBadge>& badges) {
    double width = 0;
    for (const TooltipBadge& badge : badges) {
        width += measure(badge.text, kBadgeSize) + badgePad();
        if (badge.icon != TooltipIcon::None) width += kBadgeIcon;
    }
    return width;
}

/// A stretch of one row in one colour. `marked` runs came out of the line's
/// markup and are painted at full alpha.
struct TooltipRun {
    std::string text;
    std::uint32_t color;
    bool marked;
};

/// One laid-out row: a tooltip line after alt substitution and word wrapping,
/// with its top offset from the content's top edge.
struct TooltipRow {
    const TooltipLine* line;
    std::string text;
    /// A markup line's row, split where its colour changes. Empty otherwise.
    std::vector<TooltipRun> runs;
    double y;
    /// The line's first row, the only one its label can be on.
    bool first;
};

struct TooltipLayout {
    std::vector<TooltipRow> rows;
    double textWidth = 0;
    double textHeight = 0;
};

/// A line's text with florr's `<c val="#RRGGBB">` markup taken out, and the
/// colour each byte was marked with (-1 for none).
struct MarkedText {
    std::string plain;
    std::vector<std::int32_t> tint;
};

MarkedText parseColours(const std::string& s) {
    static const std::string kOpen = "<c val=\"#";
    static const std::string kClose = "</c>";
    MarkedText out;
    std::vector<std::int32_t> stack;
    std::size_t i = 0;
    while (i < s.size()) {
        if (s.compare(i, kClose.size(), kClose) == 0) {
            if (!stack.empty()) stack.pop_back();
            i += kClose.size();
            continue;
        }
        if (s.compare(i, kOpen.size(), kOpen) == 0) {
            const std::size_t end = s.find("\">", i + kOpen.size());
            if (end == i + kOpen.size() + 6) {
                stack.push_back(static_cast<std::int32_t>(
                    std::strtol(s.substr(i + kOpen.size(), 6).c_str(), nullptr, 16)));
                i = end + 2;
                continue;
            }
        }
        out.plain += s[i];
        out.tint.push_back(stack.empty() ? -1 : stack.back());
        ++i;
    }
    return out;
}

/// One tooltip row: an OPAQUE outline under a fill that carries the row's
/// alpha.
///
/// ui::text() fills at whatever alpha the canvas is on, so dimming a stat row
/// with globalAlpha would fade its black outline too. The browser passes the
/// alpha in the fill colour alone -- TOOLTIP_STAT_COLOR is
/// rgba(255,255,255,0.56) -- while drawText strokes with solid #000000, which
/// is why those rows stay crisply outlined over the half-black box.
///
/// So the row goes to paintRun with a fill alpha of its own, because that is
/// the only seam where the two passes can differ. Every row goes through here,
/// dimmed or not, so one anchor governs the whole box; `x, y` is the top-left
/// corner, the only alignment the painter ever asks for, resolved exactly as
/// draw.cpp resolves Baseline::Top.
void paintRow(Canvas& canvas, const std::string& s, double x, double y, const TextStyle& style,
              double fillAlpha) {
    paintRun(canvas, s, x, y + ascent(style.size), style, 1.0, fillAlpha);
}

/// Greedy wrap on spaces, as the browser does. A single word wider than the
/// limit still gets its own row and overflows -- breaking mid-word would be
/// worse to read than a slightly wide box.
///
/// Rows come out as [begin, end) byte ranges of `text`, shifted by `offset`,
/// so a markup line can look up what colour each of their bytes was marked.
void wrapParagraph(const std::string& text, std::size_t offset, double size, double maxWidth,
                   std::vector<std::pair<std::size_t, std::size_t>>& out) {
    const std::size_t before = out.size();
    if (maxWidth > 0 && measure(text, size) > maxWidth) {
        std::size_t rowStart = 0;
        std::size_t rowEnd = 0;
        bool started = false;
        std::size_t at = 0;
        while (at <= text.size()) {
            const std::size_t space = text.find(' ', at);
            const std::size_t wordEnd = space == std::string::npos ? text.size() : space;
            if (started && measure(text.substr(rowStart, wordEnd - rowStart), size) > maxWidth) {
                out.push_back({offset + rowStart, offset + rowEnd});
                rowStart = at;
            }
            rowEnd = wordEnd;
            started = true;
            if (space == std::string::npos) break;
            at = space + 1;
        }
        if (started) out.push_back({offset + rowStart, offset + rowEnd});
    }
    // An empty paragraph is still a row: florr's "<n/><n/>" is a blank line.
    if (out.size() == before) out.push_back({offset, offset + text.size()});
}

/// The 15 px icon after a header piece, its box's top-left at (x, y).
void paintBadgeIcon(Canvas& canvas, TooltipIcon icon, double x, double y) {
    const float cx = static_cast<float>(x + kBadgeIcon * 0.5);
    const float cy = static_cast<float>(y + kBadgeIcon * 0.5);
    if (icon == TooltipIcon::Mana) {
        // Two discs, florr's: a darker ring under the mana colour.
        setFill(canvas, 0x35B8C6u);
        canvas.beginPath();
        canvas.arc(cx, cy, 6.0f, 0.0f, 6.2831853f);
        canvas.fill();
        setFill(canvas, kStatMana);
        canvas.beginPath();
        canvas.arc(cx, cy, 4.5f, 0.0f, 6.2831853f);
        canvas.fill();
        return;
    }
    if (icon != TooltipIcon::Reload) return;
    // The arrow filled and widened by a 100-unit stroke in black, then filled
    // and widened by a 50-unit one in white: a white arrow with a thin rim.
    static const Path2D arrow = svgPathData(kReloadIconPath);
    canvas.save();
    canvas.translate(cx, cy);
    canvas.scale(static_cast<float>(kBadgeIcon * 0.002), static_cast<float>(kBadgeIcon * 0.002));
    canvas.translate(-256.0f, -256.0f);
    canvas.setLineJoin("round");
    canvas.setLineCap("round");
    for (const auto& [rgb, width] : {std::pair{kInk, 100.0f}, std::pair{kPaper, 50.0f}}) {
        setFill(canvas, rgb);
        setStroke(canvas, rgb);
        canvas.setLineWidth(width);
        canvas.fill(arrow);
        canvas.stroke(arrow);
    }
    canvas.restore();
}

/// The header pieces, right-aligned to `right` and centred on `centreY`.
void paintBadges(Canvas& canvas, const std::vector<TooltipBadge>& badges, double right,
                 double centreY) {
    double penX = right - badgesWidth(badges);
    for (const TooltipBadge& badge : badges) {
        TextStyle style = labelStyle(kBadgeSize, badge.color);
        style.roundJoin = true;
        paintRow(canvas, badge.text, penX + badgePad() * 0.5,
                 centreY - rowHeight(kBadgeSize) * 0.5, style, 1.0);
        penX += measure(badge.text, kBadgeSize) + badgePad();
        if (badge.icon == TooltipIcon::None) continue;
        paintBadgeIcon(canvas, badge.icon, penX, centreY - kBadgeIcon * 0.5);
        penX += kBadgeIcon;
    }
}

/// Resolves alt variants, wraps long lines and stacks the result top-down.
///
/// Measurement and painting both run this, rather than each doing its own
/// arithmetic: a wrap that the box did not account for is a tooltip whose text
/// hangs out of its own background.
TooltipLayout layoutRows(const std::vector<TooltipLine>& lines, bool alt) {
    TooltipLayout out;
    double y = 0;
    for (const TooltipLine& line : lines) {
        const std::string& raw = (alt && !line.altText.empty()) ? line.altText : line.text;
        const MarkedText marked = line.markup ? parseColours(raw) : MarkedText{raw, {}};
        const std::string& body = marked.plain;
        y += line.gapBefore;

        // A '\n' is a hard break, as florr's <n/> is, and each paragraph
        // between them wraps on its own.
        std::vector<std::pair<std::size_t, std::size_t>> pieces;
        std::size_t start = 0;
        while (true) {
            const std::size_t end = body.find('\n', start);
            wrapParagraph(body.substr(start, end == std::string::npos ? std::string::npos
                                                                       : end - start),
                          start, line.size, line.maxWidth, pieces);
            if (end == std::string::npos) break;
            start = end + 1;
        }

        for (const auto& [begin, end] : pieces) {
            TooltipRow row{&line, body.substr(begin, end - begin), {}, y,
                           out.rows.empty() || out.rows.back().line != &line};
            if (line.markup) {
                for (std::size_t i = begin; i < end; ++i) {
                    const std::int32_t tint = marked.tint[i];
                    if (row.runs.empty() || row.runs.back().marked != (tint >= 0) ||
                        (tint >= 0 && row.runs.back().color != static_cast<std::uint32_t>(tint))) {
                        row.runs.push_back({{}, tint >= 0 ? static_cast<std::uint32_t>(tint)
                                                          : line.color,
                                            tint >= 0});
                    }
                    row.runs.back().text += body[i];
                }
            }
            double width = measure(row.text, line.size);
            if (row.first && !line.badges.empty()) {
                width += kBadgeGap + badgesWidth(line.badges);
            }
            out.textWidth = std::max(out.textWidth, width);
            out.rows.push_back(std::move(row));
            y += rowHeight(line.size) + kTooltipLineGap;
        }
    }
    out.textHeight = std::max(0.0, y - kTooltipLineGap);
    return out;
}

} // namespace

bool TooltipDelay::update(int index, double timeSeconds, bool pointerDown) {
    if (index != hovered) {
        hovered = index;
        since = timeSeconds;
        suppressed = false;
    }
    // A press cancels the tooltip and keeps it cancelled until the pointer
    // moves on: the browser clears the pending timer on mousedown and never
    // re-arms it for the cell being clicked or dragged.
    if (pointerDown) suppressed = true;
    if (index < 0 || suppressed) return false;
    return timeSeconds - since >= kDelaySeconds;
}

Vec2 measureTooltip(const std::vector<TooltipLine>& lines, double minWidth, double extraHeight,
                    bool alt) {
    const TooltipLayout layout = layoutRows(lines, alt);
    return {std::max(layout.textWidth, minWidth) + kTooltipPadX * 2,
            layout.textHeight + extraHeight + kTooltipPadY * 2};
}

Rect paintTooltip(Canvas& canvas, double x, double y, const std::vector<TooltipLine>& lines,
                  double minWidth, double extraHeight, bool alt) {
    TextCaptureScope off(false);
    const TooltipLayout layout = layoutRows(lines, alt);
    const Vec2 size{std::max(layout.textWidth, minWidth) + kTooltipPadX * 2,
                    layout.textHeight + extraHeight + kTooltipPadY * 2};

    // Scoped, because the painter is called from the middle of a panel's own
    // draw: leaving the half-black fill and the round join set behind would
    // restyle whatever the panel draws next.
    canvas.save();

    // Half-black, no border. The box has to sit over arbitrary panel colours
    // and over the world; a border would fight whichever it lands on.
    setFill(canvas, kInk, 0.5);
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(x), static_cast<float>(y), static_cast<float>(size.x),
                     static_cast<float>(size.y), static_cast<float>(kTooltipRadius));
    canvas.fill();

    for (const TooltipRow& row : layout.rows) {
        // Outline width tracks the font size (2.4px at 20, 1.44px at 12); a
        // flat 3px swallows the body rows and reads as a different typeface.
        // No align or baseline: paintRow only knows top-left, which is the
        // only anchor a tooltip row has ever been drawn at.
        TextStyle style = labelStyle(row.line->size, row.line->color);
        style.roundJoin = true;
        double penX = x + kTooltipPadX;
        const double top = y + kTooltipPadY + row.y;
        if (row.first && !row.line->badges.empty()) {
            paintBadges(canvas, row.line->badges, x + size.x - kTooltipPadX,
                        top + rowHeight(row.line->size) * 0.5);
        }
        if (!row.runs.empty()) {
            for (const TooltipRun& run : row.runs) {
                TextStyle tinted = style;
                tinted.fill = run.color;
                paintRow(canvas, run.text, penX, top, tinted, run.marked ? 1.0 : row.line->alpha);
                penX += measure(run.text, row.line->size);
            }
            continue;
        }
        const std::size_t colon = row.text.find(':');
        if (row.first && row.line->labelColor && colon != std::string::npos) {
            // The name is never dimmed -- only the value carries the row's alpha.
            const std::string label = row.text.substr(0, colon + 1);
            TextStyle named = style;
            named.fill = *row.line->labelColor;
            paintRow(canvas, label, penX, top, named, 1.0);
            penX += measure(label, row.line->size);
            paintRow(canvas, row.text.substr(colon + 1), penX, top, style, row.line->alpha);
            continue;
        }
        paintRow(canvas, row.text, penX, top, style, row.line->alpha);
    }
    canvas.restore();

    const double textBottom = y + kTooltipPadY + layout.textHeight;
    return {x + kTooltipPadX, textBottom, size.x - kTooltipPadX * 2,
            y + size.y - kTooltipPadY - textBottom};
}

Vec2 tooltipAnchor(Rect anchor, Vec2 size, double viewWidth, double viewHeight) {
    double x = anchor.right() + 10.0;
    if (x + size.x > viewWidth) x = anchor.x - size.x - 10.0;
    double y = anchor.y;
    if (y + size.y > viewHeight) y = viewHeight - size.y - 10.0;
    if (y < 0) y = 10.0;
    return {x, y};
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

std::string titleCase(const std::string& id) {
    std::string out;
    bool capitalise = true;
    for (const unsigned char raw : id) {
        if (raw == '_' || raw == ' ' || raw == '-') {
            if (!out.empty() && out.back() != ' ') out += ' ';
            capitalise = true;
            continue;
        }
        out += static_cast<char>(capitalise ? std::toupper(raw) : std::tolower(raw));
        capitalise = false;
    }
    return out;
}

std::string abbreviate(double value) {
    if (!std::isfinite(value)) return "inf";
    const double magnitude = std::fabs(value);
    char buffer[32];
    if (magnitude < 1000.0) {
        std::snprintf(buffer, sizeof buffer, "%.0f", value);
    } else if (magnitude < 1e6) {
        std::snprintf(buffer, sizeof buffer, "%.1fK", value / 1e3);
    } else if (magnitude < 1e9) {
        std::snprintf(buffer, sizeof buffer, "%.1fM", value / 1e6);
    } else if (magnitude < 1e12) {
        std::snprintf(buffer, sizeof buffer, "%.1fB", value / 1e9);
    } else {
        std::snprintf(buffer, sizeof buffer, "%.1fT", value / 1e12);
    }
    std::string out = buffer;
    // "1.0k" reads worse than "1k", and the trailing zero is never news.
    const std::size_t dot = out.find(".0");
    if (dot != std::string::npos) out.erase(dot, 2);
    return out;
}

std::string withSeparators(double value) {
    char buffer[48];
    std::snprintf(buffer, sizeof buffer, "%.0f", std::fabs(value));
    std::string digits = buffer;
    std::string out;
    for (std::size_t i = 0; i < digits.size(); ++i) {
        if (i > 0 && (digits.size() - i) % 3 == 0) out += ',';
        out += digits[i];
    }
    return value < 0 ? "-" + out : out;
}

std::string fixedDecimals(double value, int decimals) {
    char buffer[48];
    std::snprintf(buffer, sizeof buffer, "%.*f", decimals, value);
    return buffer;
}

std::string formatCompact(double value) {
    static constexpr struct { double scale; const char* suffix; } kSteps[] = {
        {1e12, "T"}, {1e9, "B"}, {1e6, "M"}, {1e3, "K"},
    };
    char buf[32];
    for (const auto& step : kSteps) {
        if (value >= step.scale) {
            std::snprintf(buf, sizeof buf, "%.1f%s", value / step.scale, step.suffix);
            return buf;
        }
    }
    return std::to_string(static_cast<long long>(std::llround(value)));
}

std::string formatWhole(double value) {
    if (std::fabs(value) < 9.2e18) return std::to_string(static_cast<long long>(std::llround(value)));
    // DBL_MAX is 309 digits.
    char buf[320];
    std::snprintf(buf, sizeof buf, "%.0f", value);
    return buf;
}

std::string ellipsize(const std::string& text, double size, double width) {
    if (measure(text, size) <= width) return text;
    std::string out = text;
    // A character at a time: one byte cut off a multi-byte sequence leaves a
    // string that will neither measure nor draw (see utf8Prev).
    while (!out.empty() && measure(out + "...", size) > width) {
        out.erase(utf8Prev(out, out.size()));
    }
    return out + "...";
}

} // namespace flix::ui
