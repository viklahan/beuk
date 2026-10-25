import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Config } from '../config.js';
import { pdfxIccPath } from './tools.js';

/**
 * The one CMYK press profile the PDF/X job embeds, as data. The tools
 * image (deploy/Dockerfile.tools) downloads exactly these bytes; the
 * PDF/X definition file (tools/PDFX_def.ps) points at the same path and
 * names the same characterisation; the housekeeping check
 * jobs.pdfx.icc-profile-matches-def verifies all three agree.
 *
 * Why this profile (full evidence in tools/PDFX_def.ps): neither
 * IngramSpark's File Creation Guide nor KDP's help names a press
 * condition; the only named one found (second-hand) is US Web Coated
 * SWOP, whose Adobe profile may not be bundled. IDEAlliance's
 * SWOP2006_Coated3v2.icc is the redistributable US SWOP profile in the
 * ICC Profile Registry:
 *   https://registry.color.org/profile-registry/SWOP2006_Coated3v2
 *   (Reference Name: CGATS TR003; TAC 300%; Profile ID f7b89b04…)
 * and its characterisation's registry reference name is "CGATS TR 003":
 *   https://registry.color.org/cmyk-registry/cgats_tr_003
 */
export const PDFX_PROFILE = {
  path: '/usr/share/color/icc/beuk/SWOP2006_Coated3v2.icc',
  sourceUrl: 'https://registry.color.org/profile-registry/profiles/SWOP2006_Coated3v2.icc',
  /** sha256 of the registry download (2026-10-24, 2 747 952 bytes). */
  sha256: '27dc90dbeb399b76c0f91a6b387fe30c38939f034d2500712f3c43094be15e3b',
  /** ICC.1 profile ID (MD5 with flags, rendering intent and ID zeroed)
   *  — equals the "Profile ID" the registry entry lists. */
  iccProfileId: 'f7b89b0445878f17ebb85d7515da9a98',
  outputConditionIdentifier: 'CGATS TR 003',
  registryName: 'http://www.color.org',
  /** Total area coverage of the profile (registry entry: "TAC: 300%"). */
  tacPercent: 300,
} as const;

/** ICC.1 §7.2.18 profile ID: MD5 over the whole profile with the
 *  profile flags (bytes 44–47), rendering intent (64–67) and profile
 *  ID (84–99) fields set to zero. https://archive.color.org/specification/ICC.1-2022-05.pdf (7.2.18) */
export function iccProfileId(bytes: Buffer): string {
  const copy = Buffer.from(bytes);
  copy.fill(0, 44, 48);
  copy.fill(0, 64, 68);
  copy.fill(0, 84, 100);
  return createHash('md5').update(copy).digest('hex');
}

export interface ProfileCheck {
  ok: boolean;
  /** Problems found, in plain words; empty when ok. */
  problems: string[];
  /** Whether the installed profile file itself was read and verified. */
  fileVerified: boolean;
  detail: string;
}

/** Does the PDF/X definition file agree with PDFX_PROFILE, and (when the
 *  file is installed, or `requireFile`) is the installed profile exactly
 *  the pinned bytes — a CMYK output profile with the registry's ID? */
export function checkPdfxProfile(config: Pick<Config, 'pdfxDefPath'>, requireFile: boolean): ProfileCheck {
  const problems: string[] = [];
  let def = '';
  try {
    def = readFileSync(config.pdfxDefPath, 'latin1');
  } catch {
    problems.push(`the PDF/X definition file ${config.pdfxDefPath} is unreadable`);
  }
  const icc = pdfxIccPath(config.pdfxDefPath);
  if (icc !== PDFX_PROFILE.path) problems.push(`the definition's /BeukICCPath is ${icc ?? 'missing'}, not ${PDFX_PROFILE.path}`);
  if (!def.includes(`/OutputConditionIdentifier (${PDFX_PROFILE.outputConditionIdentifier})`))
    problems.push(`the definition's OutputConditionIdentifier is not (${PDFX_PROFILE.outputConditionIdentifier})`);
  if (!def.includes(`/RegistryName (${PDFX_PROFILE.registryName})`))
    problems.push(`the definition's RegistryName is not (${PDFX_PROFILE.registryName})`);
  if (!/\/DestOutputProfile \{beukICCProfile\}/.test(def)) problems.push('the OutputIntent does not embed the profile as DestOutputProfile');

  let fileVerified = false;
  if (existsSync(PDFX_PROFILE.path)) {
    const bytes = readFileSync(PDFX_PROFILE.path);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== PDFX_PROFILE.sha256) problems.push(`the installed profile's sha256 is ${sha}, not the pinned ${PDFX_PROFILE.sha256}`);
    // ICC header: device class at 12..15, colour space at 16..19.
    const cls = bytes.toString('latin1', 12, 16);
    const space = bytes.toString('latin1', 16, 20);
    if (cls !== 'prtr' || space !== 'CMYK') problems.push(`the installed profile is class "${cls}" / space "${space}", not an output (prtr) CMYK profile`);
    const id = iccProfileId(bytes);
    if (id !== PDFX_PROFILE.iccProfileId) problems.push(`the installed profile's ICC profile ID is ${id}, not the registry's ${PDFX_PROFILE.iccProfileId}`);
    fileVerified = problems.length === 0;
  } else if (requireFile) {
    problems.push(`no profile installed at ${PDFX_PROFILE.path} (build the tools image: deploy/Dockerfile.tools)`);
  }
  const ok = problems.length === 0;
  const detail = ok
    ? fileVerified
      ? `${PDFX_PROFILE.path}: sha256 and ICC profile ID match the registry file; definition names it with OutputConditionIdentifier (${PDFX_PROFILE.outputConditionIdentifier})`
      : `definition names ${PDFX_PROFILE.path} with OutputConditionIdentifier (${PDFX_PROFILE.outputConditionIdentifier}); the profile file itself was NOT checked — it is not installed and PDF/X is not configured on this server (GS_BIN unset)`
    : problems.join('; ');
  return { ok, problems, fileVerified, detail };
}
