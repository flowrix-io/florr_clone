export const blood_leaf_action = `
if memory:player:extended == 1;
explode 100;
if memory:petal:count:blood_leaf > 5;
set_petal_size 5.0;
endif;
endif;
`;