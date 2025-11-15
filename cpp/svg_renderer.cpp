#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <string>
#include <vector>
#include <memory>
#include <map>
#include <cmath>
#include <regex>

using namespace emscripten;

// SVG Animation handler
struct SVGAnimation {
    std::string attributeName;
    std::string type; // "rotate", "translate", "scale", etc.
    double from;
    double to;
    double duration; // in milliseconds
    std::string calcMode; // "linear", "spline", etc.
    bool repeat;
    
    SVGAnimation() : from(0), to(0), duration(1000), calcMode("linear"), repeat(true) {}
};

// SVG element with animation support
struct SVGElement {
    std::string svgString;
    std::vector<SVGAnimation> animations;
    double lastRenderTime;
    
    SVGElement() : lastRenderTime(0) {}
};

class SVGRenderer {
private:
    std::map<std::string, SVGElement> cache;
    
    // Extract animations from SVG string
    std::vector<SVGAnimation> extractAnimations(const std::string& svgString) {
        std::vector<SVGAnimation> anims;
        
        // Look for animateTransform elements - use escaped string instead of raw string
        std::regex animRegex("<animateTransform[^>]*attributeName=\"([^\"]*)\"[^>]*type=\"([^\"]*)\"[^>]*from=\"([^\"]*)\"[^>]*to=\"([^\"]*)\"[^>]*dur=\"([^\"]*)\"[^>]*repeatCount=\"([^\"]*)\"[^>]*>");
        std::smatch matches;
        std::string::const_iterator searchStart(svgString.cbegin());
        
        while (std::regex_search(searchStart, svgString.cend(), matches, animRegex)) {
            SVGAnimation anim;
            anim.attributeName = matches[1].str();
            anim.type = matches[2].str();
            
            // Parse from/to values (handle rotation like "0 0 0" or "360 0 0")
            std::string fromStr = matches[3].str();
            std::string toStr = matches[4].str();
            
            // Extract first number (rotation angle, etc.)
            std::regex numRegex("([-+]?[0-9]*\\.?[0-9]+)");
            std::smatch numMatch;
            if (std::regex_search(fromStr, numMatch, numRegex)) {
                anim.from = std::stod(numMatch[1].str());
            }
            if (std::regex_search(toStr, numMatch, numRegex)) {
                anim.to = std::stod(numMatch[1].str());
            }
            
            // Parse duration (handle "2s", "2000ms", etc.)
            std::string durStr = matches[5].str();
            if (durStr.find("ms") != std::string::npos) {
                anim.duration = std::stod(durStr);
            } else if (durStr.find("s") != std::string::npos) {
                anim.duration = std::stod(durStr) * 1000.0;
            } else {
                anim.duration = std::stod(durStr);
            }
            
            std::string repeatStr = matches[6].str();
            anim.repeat = (repeatStr == "indefinite" || repeatStr.empty());
            
            anims.push_back(anim);
            searchStart = matches.suffix().first;
        }
        
        return anims;
    }
    
    // Apply animations to SVG string
    std::string applyAnimations(const std::string& svgString, const std::vector<SVGAnimation>& animations, double time) {
        std::string result = svgString;
        
        for (const auto& anim : animations) {
            if (anim.type == "rotate") {
                // Calculate current rotation value
                double progress = fmod(time, anim.duration) / anim.duration;
                double currentValue = anim.from + (anim.to - anim.from) * progress;
                
                // Replace rotation values in animateTransform - use escaped string
                std::regex rotRegex("<animateTransform[^>]*type=\"rotate\"[^>]*from=\"([^\"]*)\"[^>]*>");
                std::string replacement = "<animateTransform type=\"rotate\" from=\"" + 
                                         std::to_string(currentValue) + " 0 0\" to=\"" + 
                                         std::to_string(anim.to) + " 0 0\" dur=\"" + 
                                         std::to_string(anim.duration / 1000.0) + "s\" repeatCount=\"indefinite\">";
                result = std::regex_replace(result, rotRegex, replacement);
            }
        }
        
        return result;
    }
    
    // Get animated SVG string (rendering is done in TypeScript)
    std::string getAnimatedSVG(const std::string& svgString, double time) {
        // Get or create cached element
        SVGElement* element = nullptr;
        auto it = cache.find(svgString);
        if (it != cache.end()) {
            element = &it->second;
        } else {
            SVGElement newElement;
            newElement.svgString = svgString;
            newElement.animations = extractAnimations(svgString);
            cache[svgString] = newElement;
            element = &cache[svgString];
        }
        
        // Apply animations and return animated SVG string
        return applyAnimations(element->svgString, element->animations, time);
    }
    
public:
    SVGRenderer() {}
    
    // Get animated SVG string for rendering
    std::string renderSVG(const std::string& svgString,
                          double time) {
        return getAnimatedSVG(svgString, time);
    }
    
    // Clear cache
    void clearCache() {
        cache.clear();
    }
    
    // Get cache size (for debugging)
    int getCacheSize() {
        return cache.size();
    }
};

// Export to JavaScript
EMSCRIPTEN_BINDINGS(svg_renderer) {
    class_<SVGRenderer>("SVGRenderer")
        .constructor<>()
        .function("renderSVG", &SVGRenderer::renderSVG)
        .function("clearCache", &SVGRenderer::clearCache)
        .function("getCacheSize", &SVGRenderer::getCacheSize);
}

