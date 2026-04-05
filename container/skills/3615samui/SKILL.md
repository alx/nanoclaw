---
name: 3615samui
description: Manage property listings for buysamuivillas.com (3615samui Hugo site). Activate on "list properties", "add property", "new listing", "update [property]", "publish [property]", "add image [property]", or when an image is attached alongside a property name.
allowed-tools: Bash
---

# 3615samui Property Management

Manage the `alx/3615samui` Hugo real estate site from WhatsApp. The repo is cloned into the group workspace on first use.

## Pre-flight (run before every command)

```bash
REPO=/workspace/group/3615samui

# Clone on first use
if [ ! -d "$REPO/.git" ]; then
  git clone https://alx:$GITHUB_TOKEN@github.com/alx/3615samui.git "$REPO"
fi

# Rebase to avoid merge conflicts
cd "$REPO"
git fetch origin
git rebase origin/main
echo "READY"
```

If clone or rebase fails, report the error and stop.

## When to activate

Activate on any of these patterns:

```
list properties
show listings
what properties do we have
add property
new listing
add listing
update [property name]
edit [property name]
publish [property name]
go live [property name]
add image [property name]
[image attachment] + property name in the same message
```

## Command: list properties

Scan all `content/properties/*.md` (excluding `_index.md`), extract frontmatter, display as a list:

```bash
cd /workspace/group/3615samui
for f in content/properties/*.md; do
  [ "$(basename "$f")" = "_index.md" ] && continue
  title=$(grep '^title:' "$f" | head -1 | sed 's/title: *//; s/"//g')
  price=$(grep '^price:' "$f" | head -1 | sed 's/price: *//; s/"//g')
  status=$(grep '^status:' "$f" | head -1 | sed 's/status: *//; s/"//g')
  draft=$(grep '^draft:' "$f" | head -1 | sed 's/draft: *//; s/"//g')
  label="[DRAFT]"
  [ -z "$draft" ] && label="[LIVE]"
  echo "$label $title — $price ($status)"
done
```

Reply with the numbered list.

## Command: add property (guided wizard)

Save properties as `draft: true` until explicitly published.

**Step 1** — Ask for each field in order. Do not ask all at once. Wait for the reply before asking the next.

| Field | Question | Valid values |
|-------|----------|-------------|
| Property type | "What type of property? Villa / Condo / House / Land" | Villa, Condo, House, Land |
| Title | "What is the listing title?" | free text |
| Location area | "Which area? chaweng / bophut / lamai / maenam / choeng-mon" | see taxonomy |
| Bedrooms | "How many bedrooms?" | number |
| Bathrooms | "How many bathrooms?" | number |
| Size | "Total area in sqm?" | number |
| Price | "Price? (e.g. ฿12,500,000)" | ฿ format |
| Status | "Listing status? For Sale / For Rent / Reserved / Sold" | For Sale, For Rent, Reserved, Sold |
| Description | "Short description for the listing (min 50 chars):" | ≥50 chars |
| Features | "Property features? Options: sea-view, beachfront, private-pool, infinity-pool, investment, city-view, garden-view, tropical-garden, rooftop-pool" | comma list |
| Amenities | "List amenities separated by commas:" | comma list |

**Step 2** — Derive slug: lowercase title, replace spaces and special chars with hyphens, strip leading/trailing hyphens.

**Step 3** — Build and save the file:

```bash
REPO=/workspace/group/3615samui
SLUG="{slug}"
FILE="$REPO/content/properties/$SLUG.md"
DATE=$(date -u +"%Y-%m-%dT%H:%M:%S+07:00")

cat > "$FILE" << 'FRONTMATTER'
---
title: "{title}"
date: {date}
type: properties
draft: true
image: ""
description: "{description}"
project_images: []
price: "{price}"
price_numeric: {price_numeric}
location: "{location_area_label}, Koh Samui"
location_area: ["{location_area}"]
property_feature: [{features_yaml}]
latitude:
longitude:
bedrooms: {bedrooms}
bathrooms: {bathrooms}
area: "{size} sqm"
status: "{status}"
category: ["{property_type}"]
amenities:
{amenities_yaml}
featured: false
---

{description_long}
FRONTMATTER
```

`price_numeric`: strip `฿` and commas, parse as integer.

`features_yaml`: quoted, comma-separated values for the YAML array inline.

`amenities_yaml`: each amenity as `  - "Amenity name"`.

**Step 4** — Reply with checklist:

```
✅ Draft created: content/properties/{slug}.md

Checklist:
✓ title
✓ location
✓ bedrooms / bathrooms / size
✓ price
✓ status
✓ description
✗ images — send photos to add them

Send photos and I'll attach them. Say "publish {slug}" when ready to go live.
```

## Command: update [property]

1. Find the file: search `content/properties/*.md` for a title matching the user's input (case-insensitive partial match).
2. If multiple matches, list them and ask which one.
3. Show current values of all frontmatter fields.
4. Ask which field(s) to update.
5. Rewrite the frontmatter with the new values using `sed` or a Python heredoc.
6. Reply confirming the change.

## Command: add image [property] / image attachment

When the user sends an image alongside a property name:

1. Find the property file (partial title match).
2. Derive slug from filename.
3. Image path: image attachments are available at their path in the group workspace (via image-vision). If the file is already on disk, use it; otherwise save the base64 content to disk.
4. Save to: `static/images/properties/{slug}/{timestamp}.png`

```bash
REPO=/workspace/group/3615samui
SLUG="{slug}"
IMGDIR="$REPO/static/images/properties/$SLUG"
mkdir -p "$IMGDIR"
TIMESTAMP=$(date +%s)
DEST="$IMGDIR/${TIMESTAMP}.png"
cp "{source_path}" "$DEST"
IMGREF="images/properties/$SLUG/${TIMESTAMP}.png"
```

5. Update frontmatter:
   - If `image:` field is empty (`""`): set `image: "{IMGREF}"`
   - Append to `project_images:` list

6. Reply:

```
📸 Image saved: {IMGREF}
Total images: {count}
✓ Cover image set (first image)
```

## Command: publish [property]

1. Find the file (partial title match).
2. Check mandatory fields — reply with missing items and stop if any are absent:
   - title (non-empty)
   - image (non-empty)
   - price (non-empty)
   - location_area (non-empty array)
   - bedrooms (numeric)
   - bathrooms (numeric)
   - area (non-empty)
   - status (non-empty)
   - description (≥50 chars)

3. Remove the `draft: true` line from frontmatter:

```bash
sed -i '/^draft: true/d' "$FILE"
```

4. Rebase, commit, push:

```bash
cd /workspace/group/3615samui
git fetch origin
git rebase origin/main
git add "content/properties/{slug}.md" "static/images/properties/{slug}/"
git commit -m "feat(properties): publish {title}"
git push origin main
```

5. Reply:

```
✅ Published: {title}
Deploys via GitHub Actions (~2 min)
https://buysamuivillas.com/properties/{slug}/
```

## Error handling

| Condition | Action |
|-----------|--------|
| Clone fails | Reply: "❌ Could not clone repo: {error}" |
| Rebase conflict | Reply: "⚠️ Rebase conflict in: {files}. Run `git rebase --abort` to reset, or resolve and say 'continue rebase'" |
| Push fails (auth) | Reply: "❌ Push failed — GITHUB_TOKEN may have expired" |
| Push fails (non-fast-forward) | Fetch + rebase again, retry push once |
| Invalid taxonomy value | Reply with valid options and ask again |
| No property match | Reply: "No property found matching '{query}'. Say 'list properties' to see all." |
| Multiple matches | List matches and ask which one |
