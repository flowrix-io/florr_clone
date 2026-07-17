"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blood_leaf_action = void 0;
exports.blood_leaf_action = `
if memory:player:extended == 1;
explode 100;
heal -1
set_memory blood_leaf_count memory:petal:count:blood_leaf;
endif;
`;
