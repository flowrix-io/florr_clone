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
    std::vector<double> keyframeValues; // For keyframe animations (values="...")
    bool additive; // Whether animation is additive (additive="sum")
    std::string existingTransform; // The existing transform on the element (for additive animations)
    
    SVGAnimation() : from(0), to(0), duration(1000), calcMode("linear"), repeat(true), additive(false) {}
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
        
        // Look for animateTransform elements - handle both from/to and values formats
        // Pattern 1: from/to format
        std::regex animRegex1("<animateTransform[^>]*attributeName=\"([^\"]*)\"[^>]*type=\"([^\"]*)\"[^>]*from=\"([^\"]*)\"[^>]*to=\"([^\"]*)\"[^>]*dur=\"([^\"]*)\"[^>]*repeatCount=\"([^\"]*)\"[^>]*>");
        // Pattern 2: values format (e.g., values="0; 3.6; 0")
        std::regex animRegex2("<animateTransform[^>]*attributeName=\"([^\"]*)\"[^>]*type=\"([^\"]*)\"[^>]*values=\"([^\"]*)\"[^>]*dur=\"([^\"]*)\"[^>]*repeatCount=\"([^\"]*)\"[^>]*>");
        
        // Check for additive="sum" attribute
        std::regex additiveRegex("additive=\"sum\"");
        
        std::smatch matches;
        std::string::const_iterator searchStart(svgString.cbegin());
        
        // Try pattern 1 (from/to)
        while (std::regex_search(searchStart, svgString.cend(), matches, animRegex1)) {
            SVGAnimation anim;
            anim.attributeName = matches[1].str();
            anim.type = matches[2].str();
            
            // Check if additive="sum"
            std::string animTag = matches[0].str();
            anim.additive = std::regex_search(animTag, additiveRegex);
            
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
        
        // Try pattern 2 (values)
        searchStart = svgString.cbegin();
        while (std::regex_search(searchStart, svgString.cend(), matches, animRegex2)) {
            SVGAnimation anim;
            anim.attributeName = matches[1].str();
            anim.type = matches[2].str();
            
            // Check if additive="sum"
            std::string animTag = matches[0].str();
            anim.additive = std::regex_search(animTag, additiveRegex);
            
            // Parse values (e.g., "0; 3.6; 0" or "10; -10; 10")
            // For keyframe animations, we need to interpolate based on time
            std::string valuesStr = matches[3].str();
            std::regex numRegex("([-+]?[0-9]*\\.?[0-9]+)");
            std::smatch numMatch;
            std::vector<double> values;
            
            std::string::const_iterator valStart(valuesStr.cbegin());
            while (std::regex_search(valStart, valuesStr.cend(), numMatch, numRegex)) {
                values.push_back(std::stod(numMatch[1].str()));
                valStart = numMatch.suffix().first;
            }
            
            if (values.size() >= 2) {
                // Store all keyframe values for interpolation
                anim.keyframeValues = values;
                anim.from = values[0];
                anim.to = values[values.size() - 1];
            } else if (values.size() == 1) {
                anim.from = 0;
                anim.to = values[0];
            }
            
            // Parse duration
            std::string durStr = matches[4].str();
            if (durStr.find("ms") != std::string::npos) {
                anim.duration = std::stod(durStr);
            } else if (durStr.find("s") != std::string::npos) {
                anim.duration = std::stod(durStr) * 1000.0;
            } else {
                anim.duration = std::stod(durStr);
            }
            
            std::string repeatStr = matches[5].str();
            anim.repeat = (repeatStr == "indefinite" || repeatStr.empty());
            
            anims.push_back(anim);
            searchStart = matches.suffix().first;
        }
        
        return anims;
    }
    
    // Apply animations to SVG string
    std::string applyAnimations(const std::string& svgString, const std::vector<SVGAnimation>& animations, double time) {
        std::string result = svgString;
        
        // Process animations in reverse order to avoid position shifts when removing elements
        for (int animIndex = static_cast<int>(animations.size()) - 1; animIndex >= 0; --animIndex) {
            const auto& anim = animations[animIndex];
            
            // Calculate current animation value
            double progress = fmod(time, anim.duration) / anim.duration;
            double currentValue;
            
            // Handle keyframe animations (values="...")
            if (!anim.keyframeValues.empty() && anim.keyframeValues.size() > 2) {
                // Interpolate between keyframes
                double keyframeProgress = progress * (anim.keyframeValues.size() - 1);
                size_t keyframeIndex = static_cast<size_t>(keyframeProgress);
                if (keyframeIndex >= anim.keyframeValues.size() - 1) {
                    keyframeIndex = anim.keyframeValues.size() - 2;
                }
                double localProgress = keyframeProgress - keyframeIndex;
                currentValue = anim.keyframeValues[keyframeIndex] + 
                              (anim.keyframeValues[keyframeIndex + 1] - anim.keyframeValues[keyframeIndex]) * localProgress;
            } else {
                // Simple linear interpolation
                currentValue = anim.from + (anim.to - anim.from) * progress;
            }
            
            if (anim.type == "rotate") {
                // Build a more specific regex pattern to find this exact animation
                std::string animPattern;
                if (!anim.keyframeValues.empty()) {
                    // Match by values - build pattern from first and last values
                    std::string firstVal = std::to_string(static_cast<int>(anim.keyframeValues[0]));
                    std::string lastVal = std::to_string(static_cast<int>(anim.keyframeValues[anim.keyframeValues.size() - 1]));
                    animPattern = "<animateTransform[^>]*type=\"rotate\"[^>]*values=\"[^\"]*" + firstVal + "[^\"]*" + lastVal + "[^\"]*\"[^>]*>";
                } else {
                    // Match by from/to
                    std::string fromVal = std::to_string(static_cast<int>(anim.from));
                    std::string toVal = std::to_string(static_cast<int>(anim.to));
                    animPattern = "<animateTransform[^>]*type=\"rotate\"[^>]*from=\"[^\"]*" + fromVal + "[^\"]*\"[^>]*to=\"[^\"]*" + toVal + "[^\"]*\"[^>]*>";
                }
                
                std::regex animRegex(animPattern);
                std::smatch animMatch;
                
                // Find the animateTransform element
                if (std::regex_search(result, animMatch, animRegex)) {
                    size_t animPos = animMatch.position();
                    size_t animLen = animMatch.length();
                    
                    // Check if this is additive
                    std::string animTag = animMatch.str();
                    bool isAdditive = animTag.find("additive=\"sum\"") != std::string::npos;
                    
                    // Look backwards to find the parent element
                    std::string beforeAnim = result.substr(0, animPos);
                    size_t parentStart = beforeAnim.rfind('<');
                    if (parentStart != std::string::npos) {
                        // Check if it's a valid parent element
                        std::string tagStart = beforeAnim.substr(parentStart);
                        if (tagStart.find("<g ") == 0 || tagStart.find("<g>") == 0 || 
                            tagStart.find("<ellipse ") == 0 || tagStart.find("<path ") == 0 ||
                            tagStart.find("<circle ") == 0 || tagStart.find("<rect ") == 0) {
                            
                            // Find the closing > of the parent tag
                            size_t tagEnd = beforeAnim.find('>', parentStart);
                            if (tagEnd != std::string::npos) {
                                std::string parentTag = beforeAnim.substr(parentStart, tagEnd - parentStart + 1);
                                
                                // Remove the animateTransform (handle both self-closing and with closing tag)
                                std::regex fullAnimRegex("<animateTransform[^>]*type=\"rotate\"[^>]*(?:/>|>\\s*</animateTransform>)");
                                std::string afterAnim = result.substr(animPos);
                                std::smatch fullMatch;
                                if (std::regex_search(afterAnim, fullMatch, fullAnimRegex)) {
                                    result = beforeAnim + fullMatch.suffix().str();
                                } else {
                                    // Fallback: just remove the matched part
                                    result = beforeAnim + result.substr(animPos + animLen);
                                }
                                
                                // Add or update transform on parent tag
                                if (parentTag.find("transform=") == std::string::npos) {
                                    // Add transform attribute
                                    size_t closePos = parentTag.length() - 1; // Position of '>'
                                    std::string newTag = parentTag.substr(0, closePos) + 
                                                       " transform=\"rotate(" + std::to_string(currentValue) + " 0 0)\"" + 
                                                       parentTag.substr(closePos);
                                    result = result.substr(0, parentStart) + newTag + result.substr(parentStart + parentTag.length());
                                } else {
                                    // Extract existing transform
                                    std::regex transformRegex("transform=\"([^\"]*)\"");
                                    std::smatch transformMatch;
                                    std::string existingTransform = "";
                                    if (std::regex_search(parentTag, transformMatch, transformRegex)) {
                                        existingTransform = transformMatch[1].str();
                                    }
                                    
                                    std::string newTransform;
                                    if ((isAdditive || anim.additive) && !existingTransform.empty()) {
                                        // For additive animations, we need to combine with existing transform
                                        // Parse existing transform to extract rotation value
                                        // Example: "translate(-11 -8) rotate(18)" -> extract 18, add currentValue
                                        std::regex rotateRegex("rotate\\(([-+]?[0-9]*\\.?[0-9]+)");
                                        std::smatch rotateMatch;
                                        if (std::regex_search(existingTransform, rotateMatch, rotateRegex)) {
                                            double existingRot = std::stod(rotateMatch[1].str());
                                            double combinedRot = existingRot + currentValue;
                                            // Replace the rotation value in the existing transform
                                            std::string newRotStr = "rotate(" + std::to_string(combinedRot);
                                            existingTransform = std::regex_replace(existingTransform, rotateRegex, newRotStr);
                                            newTransform = "transform=\"" + existingTransform + "\"";
                                        } else {
                                            // No existing rotation, append it
                                            newTransform = "transform=\"" + existingTransform + " rotate(" + std::to_string(currentValue) + " 0 0)\"";
                                        }
                                    } else {
                                        // Replace existing transform
                                        newTransform = "transform=\"rotate(" + std::to_string(currentValue) + " 0 0)\"";
                                    }
                                    
                                    std::string newTag = std::regex_replace(parentTag, transformRegex, newTransform);
                                    result = result.substr(0, parentStart) + newTag + result.substr(parentStart + parentTag.length());
                                }
                            }
                        }
                    }
                }
            } else {
                // For other animation types, just remove the animateTransform element
                // This prevents invalid SVG syntax - the static SVG will render without animation
                std::regex animRegex("<animateTransform[^>]*type=\"" + anim.type + "\"[^>]*/?>");
                result = std::regex_replace(result, animRegex, "");
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

