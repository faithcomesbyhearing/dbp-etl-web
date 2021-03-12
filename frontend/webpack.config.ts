import { CleanWebpackPlugin } from "clean-webpack-plugin";
import DotenvWebpackPlugin from "dotenv-webpack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import path from "path";
import { Configuration, EnvironmentPlugin } from "webpack";
import "webpack-dev-server";

export default (environment: { production: boolean }): Configuration => ({
  mode: environment.production ? "production" : "development",
  devtool: false,
  entry: "./src/index.tsx",
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    fallback: {
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      util: require.resolve("util/"),
      fs: false,
    },
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].[contenthash:8].js",
    publicPath: '/',
  },
  devServer: {
    historyApiFallback: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              [
                "@babel/preset-react",
                {
                  runtime: "automatic", // Default with BABEL_8_BREAKING https://github.com/babel/website/pull/2289
                  development: !environment.production,
                },
              ],
              "@babel/preset-typescript",
            ],
          },
        },
      },
    ],
  },
  plugins: [
    new EnvironmentPlugin({
      DEBUG: !environment.production,
      VERSION: require("./package.json").version,
    }),
    new DotenvWebpackPlugin({ safe: true }),
    new CleanWebpackPlugin(),
    new HtmlWebpackPlugin({
      template: "src/index.html",
    }),
  ],
});
