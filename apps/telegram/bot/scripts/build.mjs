import { builtinModules } from "node:module";
import { rm, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDirectory, "..");
const outputDirectory = resolve(packageRoot, "dist");
const outputFile = resolve(outputDirectory, "microsonya-bot.mjs");

if (
  basename(outputDirectory) !== "dist" ||
  relative(packageRoot, outputDirectory) !== "dist"
) {
  throw new Error(
    `Refusing to clean unexpected output path: ${outputDirectory}`,
  );
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const result = await build({
  entryPoints: [resolve(packageRoot, "src/main.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: true,
  keepNames: true,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  plugins: [optionalDependencyStubs()],
});

assertNoExternalPackages(result.metafile);

const outputEntries = await readdir(outputDirectory);
if (outputEntries.length !== 1 || outputEntries[0] !== basename(outputFile)) {
  throw new Error(
    `Expected exactly one bot bundle, found: ${outputEntries.join(", ")}`,
  );
}

const syntaxCheck = spawnSync(process.execPath, ["--check", outputFile], {
  encoding: "utf8",
});
if (syntaxCheck.status !== 0) {
  throw new Error(
    `Generated bundle failed node --check:\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
}

const { size } = await stat(outputFile);
console.info(
  `Bot bundle ready: ${relative(process.cwd(), outputFile)} (${formatBytes(size)})`,
);

function optionalDependencyStubs() {
  return {
    name: "optional-dependency-stubs",
    setup(context) {
      context.onResolve(
        { filter: /^(encoding|pg-native|supports-color)$/ },
        ({ path }) => ({
          path,
          namespace: "optional-dependency",
        }),
      );
      context.onLoad(
        { filter: /.*/, namespace: "optional-dependency" },
        ({ path }) => ({
          loader: "js",
          contents: [
            `const error = new Error(${JSON.stringify(
              `${path} is an unsupported optional dependency in the Microsonya bot bundle.`,
            )});`,
            'error.code = "MODULE_NOT_FOUND";',
            "throw error;",
          ].join("\n"),
        }),
      );
    },
  };
}

function assertNoExternalPackages(metafile) {
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]);
  const externalImports = Object.values(metafile.outputs).flatMap(
    ({ imports }) => imports.filter(({ external }) => external),
  );
  const forbidden = externalImports.filter(({ path }) => !builtins.has(path));

  if (forbidden.length > 0) {
    throw new Error(
      `Bundle contains external packages: ${forbidden
        .map(({ path }) => path)
        .join(", ")}`,
    );
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
