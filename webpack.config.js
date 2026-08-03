const path = require('path');
const webpack = require('webpack');

// Exported as a function so the build mode (`--mode production` from
// `npm run build`, `--mode development` from `npm run dev`) can be baked into
// the bundle as `__DEV__`. Production folds it to `false`, so the debug-only
// `window` handles in src/dev_expose.ts are dead code the minifier removes.
module.exports = (env, argv) => {
    const isDev = (argv && argv.mode) !== 'production';
    return {
        entry: './src/index.ts',
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/,
                },
                {
                    test: /\.svg$/,
                    type: 'asset/source',
                },
            ],
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js'],
        },
        output: {
            filename: 'bundle.js',
            path: path.resolve(__dirname, 'dist'),
        },
        plugins: [
            new webpack.DefinePlugin({
                __DEV__: JSON.stringify(isDev),
                // Define the typeof form too, so the `typeof __DEV__` guard in
                // dev_build.ts constant-folds instead of surviving into prod.
                'typeof __DEV__': JSON.stringify('boolean'),
            }),
        ],
        optimization: {
            minimize: true,
        },
        devtool: 'source-map',
    };
};
