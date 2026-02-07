#!/usr/bin/env node

import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const getFiles = async (dir) => {
  try {
    const files = await fs.readdir(dir);
    return files;
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
    return [];
  }
};

const copyFile = async (from, to) => {
  if (!existsSync(from)) {
    console.error(`Source file does not exist: ${from}`);
    return false;
  }

  const dirname = path.dirname(to);
  if (!existsSync(dirname)) {
    mkdirSync(dirname, { recursive: true });
  }

  await fs.copyFile(from, to).catch(() => null);
};

async function main() {
  const args = process.argv.slice(2);
  const [target, appName] = args;
  const bundleDirWithTarget = path.resolve(
    `src-tauri/target/${target}/release/bundle`
  );
  const bundleDirWithoutTarget = path.resolve(`src-tauri/target/release/bundle`);

  let bundleDir = bundleDirWithTarget;
  if (!existsSync(bundleDir) && existsSync(bundleDirWithoutTarget)) {
    bundleDir = bundleDirWithoutTarget;
  }

  console.log(`Using bundle directory: ${bundleDir}`);

  let outputs = {};
  switch (process.platform) {
    case "darwin":
      outputs = {
        dmg: [".dmg"],
      };
      break;
    case "win32":
      outputs = {
        nsis: [".exe"],
      };
  }
  for (const dir in outputs) {
    const targetDir = path.join(bundleDir, dir);
    const files = await getFiles(targetDir);
    if (files.length === 0) {
      console.warn(`No files found in ${targetDir}`);
    }
    for (const filename of files) {
      const suffix = outputs[dir].find((e) => filename.endsWith(e));
      if (suffix) {
        await copyFile(
          path.join(targetDir, filename),
          path.join("dist", appName + suffix)
        );
        console.log(`✅ ${appName + suffix}`);
      }
    }
  }
}

main();
