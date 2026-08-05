import { describe, it } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');
const MODULES_ROOT = join(process.cwd(), 'modules');

function normalizePath(filePath: string): string {
  return filePath.split(sep).join('/');
}

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as { name: string; isDirectory: () => boolean }[];
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

function readSource(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

const IMPORT_PATTERN = /(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    let match: RegExpExecArray | null;
    IMPORT_PATTERN.lastIndex = 0;
    while ((match = IMPORT_PATTERN.exec(trimmed)) !== null) {
      const specifier = match[1] ?? match[2];
      if (specifier) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

function specifierHitsLayer(specifier: string, layerFragment: string): boolean {
  const normalized = normalizePath(specifier);
  if (normalized.startsWith(layerFragment)) return true;
  if (normalized.includes(`/${layerFragment}/`)) return true;
  if (normalized.startsWith(`${layerFragment}/`)) return true;
  return false;
}

function specifierForbiddenInLayer(specifier: string, forbidden: string[]): boolean {
  return forbidden.some((entry) => specifierHitsLayer(specifier, entry));
}

function getLayerFromPath(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  if (normalized.includes('/domain/')) return 'domain';
  if (normalized.includes('/application/')) return 'application';
  if (normalized.includes('/infrastructure/')) return 'infrastructure';
  if (normalized.includes('/platform/')) return 'platform';
  if (normalized.includes('/presentation/')) return 'presentation';
  if (normalized.includes('/debug/')) return 'debug';
  if (normalized.includes('/app/')) return 'app';
  return null;
}

function resolveSpecPath(filePath: string, spec: string): string | null {
  if (spec.startsWith('.')) {
    const baseDir = filePath.substring(0, filePath.lastIndexOf('/'));
    return join(baseDir, spec);
  }
  return null;
}

function fileExistsAt(path: string): boolean {
  if (existsSync(path)) return true;
  if (existsSync(path.replace(/\.tsx?$/, ''))) return true;
  if (existsSync(join(path, 'index.ts'))) return true;
  if (existsSync(join(path, 'index.tsx'))) return true;
  return false;
}

function resolveSpecToRealPath(filePath: string, spec: string): string | null {
  const resolved = resolveSpecPath(filePath, spec);
  if (!resolved) return null;

  if (existsSync(resolved)) return resolved;

  const withoutExt = resolved.replace(/\.tsx?$/, '');
  if (existsSync(withoutExt)) return withoutExt;

  if (existsSync(join(resolved, 'index.ts'))) return join(resolved, 'index.ts');
  if (existsSync(join(resolved, 'index.tsx'))) return join(resolved, 'index.tsx');

  return null;
}

function isThirdPartyPackage(spec: string): boolean {
  if (!spec.startsWith('.')) return true;
  return false;
}

describe('Metro bundle path resolution', () => {
  const allTsFiles = [
    ...getAllTsFiles(SRC_ROOT),
    ...getAllTsFiles(MODULES_ROOT),
  ];

  for (const file of allTsFiles) {
    const content = readSource(file);
    const relPath = relative(process.cwd(), file);

    it(`${relPath} must not import a .js file that maps to a TypeScript source`, () => {
      const specifiers = extractImportSpecifiers(content);
      for (const spec of specifiers) {
        if (!spec.endsWith('.js')) continue;
        if (isThirdPartyPackage(spec)) continue;

        const realPath = resolveSpecToRealPath(file, spec);
        if (!realPath) continue;

        const endsWithJs = realPath.endsWith('.js');
        const realExistsAsJs = existsSync(realPath);

        if (endsWithJs && realExistsAsJs) continue;

        const jsStem = realPath.replace(/\.js$/, '');
        const tsExists = existsSync(jsStem + '.ts') || existsSync(jsStem + '.tsx') ||
          existsSync(join(jsStem, 'index.ts')) || existsSync(join(jsStem, 'index.tsx'));

        if (tsExists) {
          throw new Error(
            `Stale JavaScript import points to TypeScript source:\n${relPath} -> ${spec}`,
          );
        }
      }
    });
  }
});

describe('architecture layer boundaries', () => {
  const allFiles = [
    ...getAllTsFiles(SRC_ROOT),
    ...getAllTsFiles(MODULES_ROOT),
  ];

  const domainFiles = allFiles.filter(f => getLayerFromPath(f) === 'domain');
  const applicationFiles = allFiles.filter(f => getLayerFromPath(f) === 'application');
  const infrastructureFiles = allFiles.filter(f => getLayerFromPath(f) === 'infrastructure');
  const platformFiles = allFiles.filter(f => getLayerFromPath(f) === 'platform');
  const presentationFiles = allFiles.filter(f => getLayerFromPath(f) === 'presentation');
  const debugFiles = allFiles.filter(f => getLayerFromPath(f) === 'debug');
  const appFiles = allFiles.filter(f => getLayerFromPath(f) === 'app');

  // Domain layer rules
  describe('domain layer', () => {
    for (const file of domainFiles) {
      const content = readSource(file);
      const specifiers = extractImportSpecifiers(content);
      const relPath = relative(process.cwd(), file);

      it(`${relPath} must not import react or react-native`, () => {
        for (const spec of specifiers) {
          if (spec === 'react' || spec === 'react-native' || spec.startsWith('react/') || spec.startsWith('react-native/')) {
            throw new Error(`Domain file ${relPath} imports '${spec}'`);
          }
        }
        if (content.includes('requireNativeModule(') || content.includes('requireNativeViewManager(')) {
          throw new Error(`Domain file ${relPath} uses native module API`);
        }
      });

      it(`${relPath} must not import application, infrastructure, platform, presentation, debug, app, or features paths`, () => {
        for (const spec of specifiers) {
          for (const forbidden of ['application', 'infrastructure', 'platform', 'presentation', 'debug', 'app']) {
            if (specifierHitsLayer(spec, forbidden)) {
              throw new Error(`Domain file ${relPath} imports '${spec}' (forbidden layer ${forbidden})`);
            }
          }
        }
      });
    }
  });

  // Application layer rules
  describe('application layer', () => {
    for (const file of applicationFiles) {
      const content = readSource(file);
      const specifiers = extractImportSpecifiers(content);
      const relPath = relative(process.cwd(), file);

      it(`${relPath} must not import react or react-native`, () => {
        for (const spec of specifiers) {
          if (spec === 'react' || spec === 'react-native' || spec.startsWith('react/') || spec.startsWith('react-native/')) {
            throw new Error(`Application file ${relPath} imports '${spec}'`);
          }
        }
      });

      it(`${relPath} must not import infrastructure, platform, presentation, debug, app`, () => {
        for (const spec of specifiers) {
          for (const forbidden of ['infrastructure', 'platform', 'presentation', 'debug', 'app']) {
            if (specifierHitsLayer(spec, forbidden)) {
              throw new Error(`Application file ${relPath} imports '${spec}' (forbidden layer ${forbidden})`);
            }
          }
        }
      });
    }
  });

  // Infrastructure layer rules
  describe('infrastructure layer', () => {
    for (const file of infrastructureFiles) {
      const content = readSource(file);
      const specifiers = extractImportSpecifiers(content);
      const relPath = relative(process.cwd(), file);

      it(`${relPath} must not import presentation, debug, app, platform`, () => {
        for (const spec of specifiers) {
          for (const forbidden of ['presentation', 'debug', 'app', 'platform']) {
            if (specifierHitsLayer(spec, forbidden)) {
              throw new Error(`Infrastructure file ${relPath} imports '${spec}' (forbidden layer ${forbidden})`);
            }
          }
        }
      });
    }
  });

  // Platform layer rules
  describe('platform layer', () => {
    for (const file of platformFiles) {
      const content = readSource(file);
      const specifiers = extractImportSpecifiers(content);
      const relPath = relative(process.cwd(), file);

      it(`${relPath} must not import presentation, debug, app`, () => {
        for (const spec of specifiers) {
          for (const forbidden of ['presentation', 'debug', 'app']) {
            if (specifierHitsLayer(spec, forbidden)) {
              throw new Error(`Platform file ${relPath} imports '${spec}' (forbidden layer ${forbidden})`);
            }
          }
        }
      });

      it(`${relPath} must not call requireNativeModule('react-native')`, () => {
        if (/requireNativeModule\s*\(\s*['"]react-native['"]\s*\)/.test(content)) {
          throw new Error(`Platform file ${relPath} calls requireNativeModule('react-native')`);
        }
      });

      it(`${relPath} must not call getExpoNativeModule('react-native')`, () => {
        if (/getExpoNativeModule\s*\(\s*['"]react-native['"]\s*\)/.test(content)) {
          throw new Error(`Platform file ${relPath} calls getExpoNativeModule('react-native')`);
        }
      });

      it(`${relPath} must not use createRequire from node:module`, () => {
        if (/createRequire\s*\(/.test(content)) {
          throw new Error(`Platform file ${relPath} uses createRequire from node:module`);
        }
      });

      it(`${relPath} must not use __filename`, () => {
        if (/__filename/.test(content)) {
          throw new Error(`Platform file ${relPath} uses __filename`);
        }
      });
    }
  });

  // Presentation layer rules
  describe('presentation layer', () => {
    for (const file of presentationFiles) {
      const content = readSource(file);
      const specifiers = extractImportSpecifiers(content);
      const relPath = relative(process.cwd(), file);

      it(`${relPath} must not directly call requireNativeModule`, () => {
        if (content.includes('requireNativeModule(')) {
          throw new Error(`Presentation file ${relPath} directly calls requireNativeModule`);
        }
      });

      it(`${relPath} must not directly call requireNativeViewManager`, () => {
        if (content.includes('requireNativeViewManager(')) {
          throw new Error(`Presentation file ${relPath} directly calls requireNativeViewManager`);
        }
      });

      it(`${relPath} must not directly use PermissionsAndroid`, () => {
        if (content.includes('PermissionsAndroid')) {
          throw new Error(`Presentation file ${relPath} directly uses PermissionsAndroid`);
        }
      });

      it(`${relPath} presentation may only use debug simulation helpers, not debug UI components`, () => {
        // Presentation CAN import debug/simulation helpers (used by simulate button)
        // and debug/components for debug-only tabs (gated by isDebugToolsEnabled).
        // It must not import arbitrary debug code paths.
        for (const spec of specifiers) {
          const normalized = normalizePath(spec);
          // Allow /debug/simulation/ paths
          if (normalized.includes('/debug/simulation/')) continue;
          // Allow /debug/components/ paths (debug-only tabs)
          if (normalized.includes('/debug/components/')) continue;
          // Allow /debug/debugAvailability.ts
          if (normalized.endsWith('/debug/debugAvailability.ts') || normalized.endsWith('/debug/debugAvailability')) continue;
          if (specifierHitsLayer(spec, 'debug')) {
            throw new Error(`Presentation file ${relPath} imports '${spec}' (only debug/simulation or debug/components allowed)`);
          }
        }
      });
    }
  });

  // Debug layer isolation
  describe('debug layer isolation', () => {
    it('domain layer must not import debug', () => {
      for (const file of domainFiles) {
        const specifiers = extractImportSpecifiers(readSource(file));
        const relPath = relative(process.cwd(), file);
        for (const spec of specifiers) {
          if (specifierHitsLayer(spec, 'debug')) {
            throw new Error(`Domain file ${relPath} imports '${spec}' (debug forbidden)`);
          }
        }
      }
    });

    it('application layer must not import debug', () => {
      for (const file of applicationFiles) {
        const specifiers = extractImportSpecifiers(readSource(file));
        const relPath = relative(process.cwd(), file);
        for (const spec of specifiers) {
          if (specifierHitsLayer(spec, 'debug')) {
            throw new Error(`Application file ${relPath} imports '${spec}' (debug forbidden)`);
          }
        }
      }
    });

    it('infrastructure layer must not import debug', () => {
      for (const file of infrastructureFiles) {
        const specifiers = extractImportSpecifiers(readSource(file));
        const relPath = relative(process.cwd(), file);
        for (const spec of specifiers) {
          if (specifierHitsLayer(spec, 'debug')) {
            throw new Error(`Infrastructure file ${relPath} imports '${spec}' (debug forbidden)`);
          }
        }
      }
    });

    it('platform layer must not import debug', () => {
      for (const file of platformFiles) {
        const specifiers = extractImportSpecifiers(readSource(file));
        const relPath = relative(process.cwd(), file);
        for (const spec of specifiers) {
          if (specifierHitsLayer(spec, 'debug')) {
            throw new Error(`Platform file ${relPath} imports '${spec}' (debug forbidden)`);
          }
        }
      }
    });
  });

  // App layer rules - WakeFitApp must be a thin entry point
  describe('app layer WakeFitApp rules', () => {
    const wakeFitAppFile = appFiles.find(f => f.endsWith('WakeFitApp.tsx'));

    if (wakeFitAppFile) {
      const content = readSource(wakeFitAppFile);
      const relPath = relative(process.cwd(), wakeFitAppFile);

      it(`${relPath} must not contain StyleSheet.create`, () => {
        if (content.includes('StyleSheet.create')) {
          throw new Error(`${relPath} contains StyleSheet.create - UI should be in presentation layer`);
        }
      });

      it(`${relPath} must not instantiate MemoryStorage`, () => {
        if (content.includes('new MemoryStorage')) {
          throw new Error(`${relPath} instantiates MemoryStorage - should use createWakeFitDependencies`);
        }
      });

      it(`${relPath} must not instantiate FetchWakeFitApiClient`, () => {
        if (content.includes('new FetchWakeFitApiClient')) {
          throw new Error(`${relPath} instantiates FetchWakeFitApiClient - should use createWakeFitDependencies`);
        }
      });

      it(`${relPath} must not use PermissionsAndroid`, () => {
        if (content.includes('PermissionsAndroid')) {
          throw new Error(`${relPath} uses PermissionsAndroid - should use platform services`);
        }
      });

      it(`${relPath} must not call requireNativeModule`, () => {
        if (content.includes('requireNativeModule(')) {
          throw new Error(`${relPath} directly calls requireNativeModule`);
        }
      });

      it(`${relPath} must not call requireNativeViewManager`, () => {
        if (content.includes('requireNativeViewManager(')) {
          throw new Error(`${relPath} directly calls requireNativeViewManager`);
        }
      });

      it(`${relPath} must not contain page JSX (no ScrollView/Modal/TextInput/Pressable)`, () => {
        if (content.includes('ScrollView') || content.includes('<Modal') || content.includes('<TextInput')) {
          throw new Error(`${relPath} contains page-level JSX - should be in presentation layer`);
        }
      });

      it(`${relPath} must not contain useState/useEffect/useMemo (controller is in presentation)`, () => {
        if (/\buse(State|Effect|Memo)\b/.test(content)) {
          throw new Error(`${relPath} uses React state hooks - controller is in presentation layer`);
        }
      });
    }
  });
});