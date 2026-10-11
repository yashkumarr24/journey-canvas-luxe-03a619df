# Remove the Word-imported international packages (FNF database)

Review only. Nothing runs until you approve.

## What will be removed

All rows are in the FNF database the website reads packages from. The Lovable Cloud database and the website's built-in destination pages are not touched.

| Item | Rows | How they are picked |
|---|---|---|
| Packages | 44 | Linked to a Word file record |
| Hotel/price options | 129 | Belong to those 44 packages |
| Option hotels | 223 | Belong to those 129 options |
| Itinerary days | 300 | Belong to those 44 packages |
| Inclusions/exclusions | 916 | Same |
| Image records | 426 | Same |
| Flights | 3 | Same |
| Notes | 49 | Same |
| Departure dates | 9 | Same |
| Possible-duplicate flags | 48 | Either side is one of the 44 |
| Enquiries | 0 | Checked again before running; stop if any exist |
| Word file records | 45 | All 45 import records, including "Disneyland Cruise 3 Nights - FNF-2026-1099 - Revised 1.docx", which has no package |
| Destinations | 7 | Slugs: bali, bhutan, dubai, baku-georgia, canton-fair, europe, thailand |
| Stored picture files | 426 | Private "package-images" storage, only the files the 426 image records point to |

## What is kept

- The 9 built-in website destinations (Kashmir, the original Dubai page and the rest), which are part of the website, not this database.
- All other tables: hotels, bookings, flights, users and so on.
- The importer tool and the empty package tables, so you can import again later.

## Safety steps

1. **Backup first:** export every row above to CSV files and list the 426 picture paths. The files are saved on the server before anything is deleted.
2. **Recount:** check that the numbers still match the table (44 / 45 / 7 / 426). If anything has changed (new packages, enquiries, or packages under another destination), stop and report.
3. **Delete in one step:** remove everything in a single all-or-nothing database step, deepest details first and destinations last. Each delete targets only the exact IDs collected in step 2. If any count is different from what was expected, everything is undone.
4. **Remove pictures:** delete only the 426 listed picture files, through the storage service rather than by editing records directly, so the files are really gone.
5. **Verify:** confirm 0 packages, 0 Word file records, 0 of the 7 destinations and 0 picture files remain. Confirm the International page still shows its built-in destinations and no longer has the "More holiday packages" section.

## Technical details

- Target: the FNF database URL plus the FNF service key for storage. Both are server-only and never printed.
- The deletion is one run of SQL inside `BEGIN … COMMIT`. It uses temporary ID tables (`pkg_ids`, `opt_ids`, `src_ids`, `dest_ids`) built from `packages.source_id IS NOT NULL` and the 7 slugs. A guard stops it with `RAISE EXCEPTION` unless `pkg_ids = 44`, `src_ids = 45`, `dest_ids = 7`, there are no enquiries and no packages outside the import.
- Delete order: package_option_hotels → package_flights → package_options → package_itinerary_days, package_inclusions, package_images, package_notes, package_departures, package_duplicate_candidates → packages → package_sources → destinations.
- Pictures are deleted with the storage remove call, in batches of 100, using the `storage://` paths taken from the backup before the database step. If storage fails, the file paths stay listed so the cleanup can be retried. The database rows are already gone at that point, but this is harmless because the files are private.
- No schema, code, or importer changes.
