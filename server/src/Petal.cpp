#include "Petal.h"

Petal Petal::fromJson(const json& j) {
    Petal p;
    p.id = j.at("id").get<std::string>();
    p.name = j.at("name").get<std::string>();
    p.asset = j.at("asset").get<std::string>();
    p.damage = j.at("damage").get<int>();
    p.radius = j.at("radius").get<float>();
    p.orbitRadius = j.at("orbitRadius").get<float>();
    p.rotationSpeed = j.at("rotationSpeed").get<float>();
    return p;
}

// Although we're not using this immediately, it's good practice to have a toJson
// for symmetry, especially for when we send this data to the client.
json to_json(const Petal& p) {
    return json{
        {"id", p.id},
        {"name", p.name},
        {"asset", p.asset},
        {"damage", p.damage},
        {"radius", p.radius},
        {"orbitRadius", p.orbitRadius},
        {"rotationSpeed", p.rotationSpeed},
        {"angle", p.angle}
    };
}

void to_json(json& j, const Petal& p) {
    j = to_json(p);
} 