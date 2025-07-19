#pragma once

#include <string>
#include <vector>
#include <map>
#include "Petal.h"

class PetalManager {
public:
    PetalManager();
    bool loadPetals(const std::string& directory);
    const Petal* getPetal(const std::string& id) const;

private:
    std::map<std::string, Petal> m_petalBlueprints;
}; 