/**
 * Beuk Weekly drafter: check a drafted issue folder with the server's own
 * upload rules (validateUpload: file names, size, sources with fetched
 * quotes, the site's parser and checkWeeklyContent) before uploading it.
 *
 *   node --import tsx tools/weekly/check-draft.ts <folder>
 *
 * Exit 0 clean, 1 with every problem listed.
 */
import { loadIssueFolder } from '../../src/weekly/content.js';
import { validateUpload } from '../../src/weekly/drafts.js';
import { folderUpload } from './folder.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: check-draft.ts <folder>');
  process.exit(1);
}
// The commit is checked by upload.ts; any well-formed one stands in here.
const problems = validateUpload(folderUpload(dir, '0'.repeat(40)));
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
const issue = loadIssueFolder(dir, 1);
console.log(`clean: ${issue.storyBySlug.size} stories, banner "${issue.banner}"`);
