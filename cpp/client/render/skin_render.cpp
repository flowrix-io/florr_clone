#include "client/render/skin_render.h"

#include <cstdlib>
#include <cmath>
#include "shared/game/signature_skin.h"

#include "client/ui/draw.h"
#include "shared/core/types.h"

namespace flix {

std::uint32_t skinHexColor(const std::string& text, std::uint32_t fallback) {
    if (!isSkinHexColor(text)) return fallback;
    return static_cast<std::uint32_t>(std::strtoul(text.c_str() + 1, nullptr, 16));
}

void renderSkinShapes(Canvas& canvas, const std::vector<SkinShape>& shapes, double radius) {
    const double scale = radius / 25.0;
    const float tau = static_cast<float>(kPi * 2.0);
    canvas.save();
    canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
    canvas.beginPath();
    canvas.arc(0.0f, 0.0f, 100.0f, 0.0f, tau);
    canvas.clip();
    for (const SkinShape& s : shapes) {
        canvas.save();
        canvas.translate(static_cast<float>(s.x), static_cast<float>(s.y));
        if (s.rot != 0) canvas.rotate(static_cast<float>(s.rot * kPi / 180.0));
        canvas.beginPath();
        switch (s.t) {
            case SkinShapeType::Circle:
                canvas.arc(0.0f, 0.0f, static_cast<float>(s.r != 0 ? s.r : 1.0), 0.0f, tau);
                break;
            case SkinShapeType::Ellipse:
                canvas.ellipse(0.0f, 0.0f, static_cast<float>(s.rx != 0 ? s.rx : 1.0),
                               static_cast<float>(s.ry != 0 ? s.ry : 1.0), 0.0f, 0.0f, tau);
                break;
            case SkinShapeType::Rect: {
                const double rx = s.rx != 0 ? s.rx : 1.0;
                const double ry = s.ry != 0 ? s.ry : 1.0;
                canvas.rect(static_cast<float>(-rx), static_cast<float>(-ry),
                            static_cast<float>(rx * 2), static_cast<float>(ry * 2));
                break;
            }
            case SkinShapeType::Line:
                // The endpoint is absolute local space; translate() already
                // moved the origin onto (x, y).
                canvas.moveTo(0.0f, 0.0f);
                canvas.lineTo(static_cast<float>(s.x2 - s.x), static_cast<float>(s.y2 - s.y));
                break;
            case SkinShapeType::Curve:
                // Endpoint and both control points are absolute local space
                // too. A fill closes the path implicitly, chord from end back
                // to start, which is what turns a curve into a blob.
                canvas.moveTo(0.0f, 0.0f);
                canvas.bezierCurveTo(
                    static_cast<float>(s.cx1 - s.x), static_cast<float>(s.cy1 - s.y),
                    static_cast<float>(s.cx2 - s.x), static_cast<float>(s.cy2 - s.y),
                    static_cast<float>(s.x2 - s.x), static_cast<float>(s.y2 - s.y));
                break;
            case SkinShapeType::Polygon:
                if (s.points.size() >= 6) {
                    canvas.moveTo(static_cast<float>(s.points[0]), static_cast<float>(s.points[1]));
                    for (std::size_t j = 2; j + 1 < s.points.size(); j += 2) {
                        canvas.lineTo(static_cast<float>(s.points[j]),
                                      static_cast<float>(s.points[j + 1]));
                    }
                    canvas.closePath();
                }
                break;
        }
        if (!s.fill.empty() && s.t != SkinShapeType::Line) {
            ui::setFill(canvas, skinHexColor(s.fill, ui::kInk));
            canvas.fill();
        }
        if (!s.stroke.empty() && s.sw > 0) {
            ui::setStroke(canvas, skinHexColor(s.stroke, ui::kInk));
            canvas.setLineWidth(static_cast<float>(s.sw));
            canvas.setLineJoin("round");
            canvas.setLineCap("round");
            canvas.stroke();
        }
        canvas.restore();
    }
    canvas.restore();
}

} // namespace flix

namespace flix {
// World-only cosmetic: fixed sample counts, analytic motion, no particle entities.
void renderSignatureAura(Canvas& c, double radius, double time) {
    if (!std::isfinite(time) || !std::isfinite(radius) || radius <= 0) return;
    c.save(); c.scale(float(radius/25),float(radius/25));
    c.setLineCap("round"); c.setLineJoin("round");
    const auto dot = [&](double x,double y,double r,unsigned color,double alpha) {
        c.beginPath(); c.arc(float(x),float(y),float(r),0,float(kTau));
        ui::setFill(c,color,alpha); c.fill();
    };
    // Translucent, interwoven aurora veils with hairline filaments.
    for (int ribbon=0;ribbon<6;++ribbon) {
        const unsigned color=ribbon%2?0xAD8AFF:0x78E9FF;
        for (int side=0;side<2;++side) {
            c.beginPath();
            for(int j=0;j<=96;++j) {
                const double a=j*kTau/96;
                const double r=65+ribbon*9+9*std::sin(a*3+time*.18+ribbon)+
                    5*std::sin(a*5-time*.12+ribbon*.7)+side*5;
                const double x=std::cos(a+time*.035)*r;
                const double y=std::sin(a+time*.035)*r*.76;
                if(j==0)c.moveTo(float(x),float(y));else c.lineTo(float(x),float(y));
            }
            c.closePath();ui::setStroke(c,color,side?.20:.07);
            c.setLineWidth(side?.55f:7.f);c.stroke();
        }
    }
    // Two counter-turning celestial seals, fine ticks and individual runes.
    for(int ring=0;ring<2;++ring) {
        c.save();c.translate(0,24);c.scale(1,.56f);c.rotate(float(time*(ring?-.035:.025)));
        const double r=ring?116:92;
        c.beginPath();c.arc(0,0,float(r),0,float(kTau));
        ui::setStroke(c,ring?0xB99AFF:0x8CEEFF,.28);c.setLineWidth(.65f);c.stroke();
        c.beginPath();
        for(int j=0;j<72;++j) {
            const double a=j*kTau/72,co=std::cos(a),si=std::sin(a);
            c.moveTo(float(co*(r-2)),float(si*(r-2)));
            c.lineTo(float(co*(r+(j%3?2:6))),float(si*(r+(j%3?2:6))));
            if(j%3==0) {
                c.moveTo(float(co*(r-9)-si*2),float(si*(r-9)+co*2));
                c.lineTo(float(co*(r-5)),float(si*(r-5)));
                c.lineTo(float(co*(r-9)+si*2),float(si*(r-9)-co*2));
            }
        }
        c.stroke();c.restore();
    }
    // Faceted satellites follow curved, fading constellation trails.
    for(int shard=0;shard<8;++shard) {
        const double a=shard*kTau/8+time*.065,r=83+12*std::sin(shard*1.7);
        const unsigned color=shard%2?0xC6A3FF:0xA0F4FF;
        for(int tail=12;tail>=0;--tail) {
            const double angle=a-tail*.025,x=std::cos(angle)*r,y=std::sin(angle)*r*.8;
            dot(x,y,tail? .65:3.5,color,tail?.35*(1-tail/13.):.12);
        }
        const double x=std::cos(a)*r,y=std::sin(a)*r*.8;
        c.beginPath();c.moveTo(float(x),float(y-5));c.lineTo(float(x+2),float(y));
        c.lineTo(float(x),float(y+5));c.lineTo(float(x-2),float(y));c.closePath();
        ui::setStroke(c,color,.65);c.setLineWidth(.7f);c.stroke();
    }
    // Slow, curling dust; soft halos instead of flashing beams.
    for(int i=0;i<72;++i) {
        const double life=std::fmod(time*.065+i*.61803398875,1.);
        const double a=i*2.39996323+life*.8+time*.018;
        const double r=35+life*95,fade=std::sin(life*kPi);
        const double x=std::cos(a)*r,y=std::sin(a)*r*.8-12*life;
        const unsigned color=i%3?0x9DEAFF:0xD3B1FF;
        dot(x,y,2.5,color,.07*fade);dot(x,y,.6,color,.7*fade);
    }
    c.restore();
}

void renderAnimatedSkin(Canvas& c,const CustomSkin& skin,double radius,double time) {
    if(!hasSignatureAnimation(skin)){renderSkinShapes(c,skin.shapes,radius);return;}
    if(!std::isfinite(time))time=0;
    c.save();c.scale(float(radius/25),float(radius/25));
    c.beginPath();c.arc(0,0,48,0,float(kTau));c.clip();
    const auto disc=[&](double x,double y,double r,std::uint32_t color,double alpha=1) {
        c.beginPath();c.arc(float(x),float(y),float(r),0,float(kTau));ui::setFill(c,color,alpha);c.fill();
    };
    // A bounded analytic particle aura: no entity updates, random generator or allocations.
    for (int particle=0;particle<24;++particle) {
        const double life=std::fmod(time*.27+particle*.61803398875,1.0);
        const double angle=particle*2.39996323+time*(particle%2?.18:-.18);
        const double r=26+life*19,fade=std::sin(life*kPi);
        const double x=std::cos(angle)*r,y=std::sin(angle)*r;
        const auto color=particle%2?0xB99AFFu:0x78E9FFu;
        disc(x,y,2.8*fade,color,.12*fade);disc(x,y,.9*fade,color,.8*fade);
    }
    // A soft halo around a dark core; no images or per-frame allocations.
    disc(0,0,29,0x684ABAu,.08);disc(0,0,26,0x78D9FFu,.10);disc(0,0,24.5,0x100E26u);
    c.setLineJoin("round");c.setLineCap("round");
    for(int ring=0;ring<12;++ring) {
        c.save();const bool violet=ring%2;
        c.rotate(float(time*(.13+ring*.018)*(violet?-1:1)));
        const double pulse=1+.035*std::sin(time*2-ring*.45);c.scale(float(pulse),float(pulse));
        c.beginPath();
        for(int edge=0;edge<6;++edge){const auto& line=skin.shapes[ring*6+edge];c.moveTo(float(line.x),float(line.y));c.lineTo(float(line.x2),float(line.y2));}
        const auto color=violet?0xB99AFFu:0x78E9FFu;
        const double width=skin.shapes[ring*6].sw*(1+.15*std::sin(time*2-ring*.4));
        ui::setStroke(c,color,.12);c.setLineWidth(float(width+3));c.stroke();
        ui::setStroke(c,color,.92);c.setLineWidth(float(std::max(.5,width*.75)));c.stroke();
        c.restore();
    }
    for(int arc=0;arc<3;++arc) {
        const double angle=time*.45+arc*kTau/3;
        c.beginPath();c.arc(0,0,float(27+.5*std::sin(time*2)),float(angle),float(angle+.8));
        ui::setStroke(c,arc%2?0xB99AFFu:0x78E9FFu,.65);c.setLineWidth(1.1f);c.stroke();
    }
    for(int spark=0;spark<6;++spark) {
        const double angle=-time*.6+spark*kTau/6,r=29+std::sin(time*2+spark)*1.2;
        const double x=std::cos(angle)*r,y=std::sin(angle)*r;const auto color=spark%2?0xB99AFFu:0x78E9FFu;
        disc(x,y,3.2,color,.10);disc(x,y,1.2,color,.95);disc(x,y,.5,0xFFFFFFu);
    }
    disc(0,0,3+.6*std::sin(time*3),0xA38BFFu,.35);disc(0,0,1.1,0xE6FFFFu);
    c.restore();
}
}
