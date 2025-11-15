const path = require('path');

module.exports = {
    entry: './src/index.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
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
    externals: {
        // Exclude Emscripten-generated files from bundling - they're loaded dynamically at runtime
        // Use a function to match the dynamic import path
        '../dist/svg_renderer.js': 'commonjs ../dist/svg_renderer.js',
        './dist/svg_renderer.js': 'commonjs ./dist/svg_renderer.js',
    },
    devServer: {
        contentBase: './dist',
        https: true,
        headers: {
            'Content-Type': 'application/javascript',
        },
    },
    optimization: {
        minimize: false,
    },
};
