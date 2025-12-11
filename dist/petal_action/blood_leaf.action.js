"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blood_leaf_action = void 0;
exports.blood_leaf_action = `
if memory:player:extended == 1;
explode 100;
set_memory blood_leaf_count memory:petal:count:blood_leaf;
if memory:blood_leaf_count > 0;
set_petal_size memory:blood_leaf_count;
endif;
endif;
`;
