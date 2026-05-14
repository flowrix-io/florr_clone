#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <string>
#include <vector>
#include <memory>
#include <map>
#include <cmath>
#include <regex>
#include <sstream>
#include <algorithm>

using namespace emscripten;

SVGRenderer renderer;

std::string toeCharacter = R"(

<svg width="240"
     height="200"
     viewBox="0 0 240 200"
     xmlns="http://www.w3.org/2000/svg">

    <!-- Speech Bubble -->
    <g>
        <rect x="120"
              y="20"
              width="90"
              height="50"
              rx="15"
              fill="white"
              stroke="black"
              stroke-width="3"/>

        <polygon points="130,70 145,85 155,70"
                 fill="white"
                 stroke="black"
                 stroke-width="3"/>

        <text x="132"
              y="50"
              font-size="12"
              font-family="Arial"
              fill="black">
            I LOVE TOES
        </text>
    </g>

    <!-- Toe -->
    <g id="toe">

        <!-- Body -->
        <ellipse cx="80"
                 cy="120"
                 rx="35"
                 ry="50"
                 fill="#f2c29b"/>

        <!-- Nail -->
        <ellipse cx="80"
                 cy="78"
                 rx="18"
                 ry="12"
                 fill="#ffe6f2"/>

        <!-- Eyes -->
        <circle cx="68"
                cy="118"
                r="4"
                fill="black"/>

        <circle cx="92"
                cy="118"
                r="4"
                fill="black"/>

        <!-- Smile -->
        <path d="M68 138 Q80 148 92 138"
              stroke="black"
              stroke-width="3"
              fill="none"/>

        <!-- Animation -->
        <animateTransform
            attributeName="transform"
            type="rotate"
            values="-8 80 120;8 80 120;-8 80 120"
            dur="700ms"
            repeatCount="indefinite"/>

    </g>

</svg>

)";

// Updated to support multi-dimensional keyframes (X, Y pairs)
struct SVGAnimation {
    std::string attributeName;
    std::string type;
    double duration;
    bool repeat;
    bool additive;
    std::vector<std::vector<double>> keyframeValues; 
    
    SVGAnimation() : duration(1000), repeat(true), additive(false) {}
};

struct SVGElement {
    std::string svgString;
    std::vector<SVGAnimation> animations;
    double lastRenderTime;
    SVGElement() : lastRenderTime(0) {}
};



class SVGRenderer {
private:
    std::map<std::string, SVGElement> cache;
    
    std::vector<SVGAnimation> extractAnimations(const std::string& svgString) {
        std::vector<SVGAnimation> anims;
        std::regex animRegex1("<animateTransform[^>]*attributeName=\"([^\"]*)\"[^>]*type=\"([^\"]*)\"[^>]*from=\"([^\"]*)\"[^>]*to=\"([^\"]*)\"[^>]*dur=\"([^\"]*)\"[^>]*repeatCount=\"([^\"]*)\"[^>]*>");
        std::regex animRegex2("<animateTransform[^>]*attributeName=\"([^\"]*)\"[^>]*type=\"([^\"]*)\"[^>]*values=\"([^\"]*)\"[^>]*dur=\"([^\"]*)\"[^>]*repeatCount=\"([^\"]*)\"[^>]*>");
        
        std::smatch matches;
        
        // Pattern 1: from/to
        std::string::const_iterator searchStart(svgString.cbegin());
        while (std::regex_search(searchStart, svgString.cend(), matches, animRegex1)) {
            SVGAnimation anim;
            anim.attributeName = matches[1].str();
            anim.type = matches[2].str();
            
            auto parseValues = [](const std::string& str) {
                std::vector<double> vals;
                std::regex numRegex("([-+]?[0-9]*\\.?[0-9]+)");
                std::smatch numMatch;
                std::string::const_iterator start(str.cbegin());
                while (std::regex_search(start, str.cend(), numMatch, numRegex)) {
                    vals.push_back(std::stod(numMatch[1].str()));
                    start = numMatch.suffix().first;
                }
                return vals;
            };
            
            std::vector<double> fromVals = parseValues(matches[3].str());
            std::vector<double> toVals = parseValues(matches[4].str());
            if (!fromVals.empty() && !toVals.empty()) {
                anim.keyframeValues.push_back(fromVals);
                anim.keyframeValues.push_back(toVals);
            }
            
            std::string durStr = matches[5].str();
            anim.duration = std::stod(durStr) * (durStr.find("ms") != std::string::npos ? 1.0 : (durStr.find("s") != std::string::npos ? 1000.0 : 1.0));
            anims.push_back(anim);
            searchStart = matches.suffix().first;
        }
        
        // Pattern 2: values="..."
        searchStart = svgString.cbegin();
        while (std::regex_search(searchStart, svgString.cend(), matches, animRegex2)) {
            SVGAnimation anim;
            anim.attributeName = matches[1].str();
            anim.type = matches[2].str();
            
            std::string valuesStr = matches[3].str();
            std::stringstream ss(valuesStr);
            std::string token;
            
            // Safely split by ';' to maintain X/Y pairs
            while (std::getline(ss, token, ';')) {
                std::vector<double> frameVals;
                std::regex numRegex("([-+]?[0-9]*\\.?[0-9]+)");
                std::smatch numMatch;
                std::string::const_iterator start(token.cbegin());
                while (std::regex_search(start, token.cend(), numMatch, numRegex)) {
                    frameVals.push_back(std::stod(numMatch[1].str()));
                    start = numMatch.suffix().first;
                }
                if (!frameVals.empty()) anim.keyframeValues.push_back(frameVals);
            }
            
            std::string durStr = matches[4].str();
            anim.duration = std::stod(durStr) * (durStr.find("ms") != std::string::npos ? 1.0 : (durStr.find("s") != std::string::npos ? 1000.0 : 1.0));
            anims.push_back(anim);
            searchStart = matches.suffix().first;
        }
        return anims;
    }
    
    std::string applyAnimations(const std::string& svgString, const std::vector<SVGAnimation>& animations, double time) {
        std::string result = svgString;
        
        for (int animIndex = static_cast<int>(animations.size()) - 1; animIndex >= 0; --animIndex) {
            const auto& anim = animations[animIndex];
            if (anim.keyframeValues.empty()) continue;
            
            double progress = fmod(time, anim.duration) / anim.duration;
            std::vector<double> currentVals;
            
            if (anim.keyframeValues.size() > 1) {
                double keyframeProgress = progress * (anim.keyframeValues.size() - 1);
                size_t idx = static_cast<size_t>(keyframeProgress);
                if (idx >= anim.keyframeValues.size() - 1) idx = anim.keyframeValues.size() - 2;
                double localProgress = keyframeProgress - idx;
                
                const auto& v1 = anim.keyframeValues[idx];
                const auto& v2 = anim.keyframeValues[idx + 1];
                size_t numVals = std::min(v1.size(), v2.size());
                
                for(size_t i = 0; i < numVals; ++i) {
                    currentVals.push_back(v1[i] + (v2[i] - v1[i]) * localProgress);
                }
            } else {
                currentVals = anim.keyframeValues[0];
            }
            
            // Generate the string (e.g., "translate(10, 20)")
            std::string transformStr = anim.type + "(";
            for(size_t i = 0; i < currentVals.size(); ++i) {
                transformStr += std::to_string(currentVals[i]);
                if (i < currentVals.size() - 1) transformStr += (anim.type == "translate" || anim.type == "scale") ? "," : " ";
            }
            transformStr += ")";
            
            std::string animPattern = "<animateTransform[^>]*type=\"" + anim.type + "\"[^>]*>";
            std::regex animRegex(animPattern);
            std::smatch animMatch;
            
            if (std::regex_search(result, animMatch, animRegex)) {
                size_t animPos = animMatch.position();
                std::string beforeAnim = result.substr(0, animPos);
                size_t parentStart = beforeAnim.rfind('<');
                
                if (parentStart != std::string::npos) {
                    size_t tagEnd = beforeAnim.find('>', parentStart);
                    if (tagEnd != std::string::npos) {
                        std::string parentTag = beforeAnim.substr(parentStart, tagEnd - parentStart + 1);
                        
                        // Remove the animateTransform tag so the XML is clean
                        std::regex fullAnimRegex("<animateTransform[^>]*type=\"" + anim.type + "\"[^>]*(?:/>|>\\s*</animateTransform>)");
                        std::string afterAnim = result.substr(animPos);
                        std::smatch fullMatch;
                        if (std::regex_search(afterAnim, fullMatch, fullAnimRegex)) {
                            result = beforeAnim + fullMatch.suffix().str();
                        } else {
                            result = beforeAnim + result.substr(animPos + animMatch.length());
                        }
                        
                        // Safely inject or append the transform to the parent tag
                        if (parentTag.find("transform=") == std::string::npos) {
                            size_t closePos = parentTag.length() - 1;
                            if (closePos > 0 && parentTag[closePos-1] == '/') closePos--;
                            std::string newTag = parentTag.substr(0, closePos) + " transform=\"" + transformStr + "\"" + parentTag.substr(closePos);
                            result = result.substr(0, parentStart) + newTag + result.substr(parentStart + parentTag.length());
                        } else {
                            std::regex transformRegex("transform=\"([^\"]*)\"");
                            std::smatch transformMatch;
                            std::string existingTransform = "";
                            if (std::regex_search(parentTag, transformMatch, transformRegex)) {
                                existingTransform = transformMatch[1].str();
                            }
                            
                            std::string newTransform = "transform=\"" + transformStr + " " + existingTransform + "\"";
                            std::string newTag = std::regex_replace(parentTag, transformRegex, newTransform);
                            result = result.substr(0, parentStart) + newTag + result.substr(parentStart + parentTag.length());
                        }
                    }
                }
            }
        }
        return result;
    }

public:
    SVGRenderer() {}
    std::string renderSVG(const std::string& svgString, double time) { return getAnimatedSVG(svgString, time); }
    std::string getAnimatedSVG(const std::string& svgString, double time) {
        SVGElement* element = nullptr;
        auto it = cache.find(svgString);
        if (it != cache.end()) { element = &it->second; } 
        else {
            SVGElement newElement;
            newElement.svgString = svgString;
            newElement.animations = extractAnimations(svgString);
            cache[svgString] = newElement;
            element = &cache[svgString];
        }
        return applyAnimations(element->svgString, element->animations, time);
    }
    void clearCache() { cache.clear(); }
    int getCacheSize() { return cache.size(); }
};

void renderLoop() {
    double time = emscripten_get_now();

    std::string frame =
        renderer.renderSVG(toeCharacter, time);

    val document = val::global("document");

    document.call<val>(
        "getElementById",
        std::string("app")
    ).set("innerHTML", frame);
}

EMSCRIPTEN_BINDINGS(svg_renderer) {
    class_<SVGRenderer>("SVGRenderer")
        .constructor<>()
        .function("renderSVG", &SVGRenderer::renderSVG)
        .function("clearCache", &SVGRenderer::clearCache)
        .function("getCacheSize", &SVGRenderer::getCacheSize);
}

int main() {
    emscripten_set_main_loop(renderLoop, 0, 1);
    return 0;
}
