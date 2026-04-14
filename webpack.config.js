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
    externals: [
        // Exclude Emscripten-generated files from bundling - they're loaded dynamically at runtime
        function({ request }, callback) {
            if (request.includes('svg_renderer_wasm.js')) {
                // Return a module that webpack won't try to bundle
                // Use 'this' to make it a global variable that will be available at runtime
                return callback(null, 'commonjs ' + request);
            }
            // Continue with normal webpack processing for other modules
            callback();
        }
    ],
    devServer: {
        contentBase: './dist',
        https: true,
        headers: {
            'Content-Type': 'application/javascript',
        },
        before: (app, server) => {
            // Serve WASM files with correct MIME type
            app.get('*.wasm', (req, res, next) => {
                res.setHeader('Content-Type', 'application/wasm');
                next();
            });
        },
    },
    optimization: {
        minimize: true,
    },
    devtool: 'source-map',
};
