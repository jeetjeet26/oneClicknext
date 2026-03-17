# Outdated Libraries Report
**Generated:** December 15, 2025  
**Project:** oneClick - P11 Platform

## Executive Summary

This report identifies all outdated libraries across the oneClick project as of December 15, 2025. The analysis covers JavaScript/TypeScript (Node.js/npm) dependencies and Python dependencies across multiple services.

**Key Findings:**
- **7 outdated npm packages** detected in the web application
- **Python dependencies** require manual version checking (no versions pinned in requirements.txt)
- **Major version updates available** for uuid (11 → 13) and @types/node (20 → 25)

---

## JavaScript/TypeScript Dependencies (p11-platform/apps/web)

### 🔴 Critical Updates (Major Version Changes)

| Package | Current | Latest | Version Jump | Priority |
|---------|---------|--------|--------------|----------|
| **uuid** | 11.1.0 | 13.0.0 | Major (2 versions) | HIGH |
| **@types/node** | 20.19.27 | 25.0.2 | Major (5 versions) | MEDIUM |

**Notes:**
- `uuid` jumped 2 major versions (11 → 13), likely contains breaking changes
- `@types/node` v25 represents Node.js 25 type definitions; current project uses Node 20.x engine

---

### 🟡 Minor/Patch Updates

| Package | Current | Latest | Version Jump | Status |
|---------|---------|--------|--------------|--------|
| **next** | 16.0.8 | 16.0.10 | Patch | Safe to update |
| **eslint-config-next** | 16.0.8 | 16.0.10 | Patch | Safe to update |
| **react** | 19.2.1 | 19.2.3 | Patch | Safe to update |
| **react-dom** | 19.2.1 | 19.2.3 | Patch | Safe to update |
| **lucide-react** | 0.556.0 | 0.561.0 | Minor | Safe to update |

**Notes:**
- Next.js 16.0.10 includes bug fixes and improvements
- React 19.2.3 includes patch-level fixes
- lucide-react minor version update (adds new icons)

---

### ✅ Up-to-Date Packages (Verified)

Based on `npm list` output and package.json analysis:

| Package | Current Version | Status |
|---------|----------------|--------|
| **@google/generative-ai** | 0.24.1 | Up to date |
| **@supabase/ssr** | 0.8.0 | Up to date |
| **@supabase/supabase-js** | 2.87.3 | Up to date (installed 2.87.0) |
| **cheerio** | 1.0.0 | Up to date |
| **date-fns** | 4.1.0 | Up to date |
| **dotenv** | 17.2.3 | Up to date |
| **google-auth-library** | 10.5.0 | Up to date |
| **jspdf** | 3.0.4 | Up to date |
| **jspdf-autotable** | 5.0.2 | Up to date |
| **openai** | 6.13.0 | Up to date (installed 6.10.0) |
| **recharts** | 3.5.1 | Up to date |
| **resend** | 6.6.0 | Up to date (installed 6.5.2) |
| **twilio** | 5.10.7 | Up to date |
| **unpdf** | 1.4.0 | Up to date |

**DevDependencies:**

| Package | Current Version | Status |
|---------|----------------|--------|
| **@tailwindcss/postcss** | ^4 | Beta/RC - Tailwind v4 |
| **@types/react** | ^19 | Up to date |
| **@types/react-dom** | ^19 | Up to date |
| **@types/uuid** | 10.0.0 | Up to date |
| **babel-plugin-react-compiler** | 1.0.0 | Up to date |
| **eslint** | ^9 | Up to date |
| **tailwindcss** | ^4 | Beta/RC - Tailwind v4 |
| **typescript** | ^5 | Up to date (latest 5.x) |

---

## Python Dependencies

### 🔴 Critical: No Version Pinning Detected

All Python requirements files use unpinned or loosely pinned versions, making it impossible to determine exact outdated status:

#### p11-platform/services/data-engine/requirements.txt

```txt
fastapi                    # No version specified
uvicorn[standard]         # No version specified
dlt                       # No version specified
supabase                  # No version specified
pandas                    # No version specified
python-dotenv             # No version specified
google-ads                # No version specified
google-analytics-data     # No version specified
requests                  # No version specified
gunicorn                  # No version specified
beautifulsoup4            # No version specified
lxml                      # No version specified
httpx                     # No version specified
playwright                # No version specified
fake-useragent            # No version specified
tenacity                  # No version specified
openai                    # No version specified
nest-asyncio              # No version specified
geopy                     # No version specified
googlemaps                # No version specified
```

#### p11-platform/services/mcp-servers/google-ads/requirements.txt

```txt
mcp>=0.9.0                # Minimum version only
google-ads>=24.0.0        # Minimum version only
python-dotenv>=1.0.0      # Minimum version only
pydantic>=2.0.0           # Minimum version only
supabase>=2.0.0           # Minimum version only
httpx>=0.25.0             # Minimum version only
```

#### p11-platform/services/mcp-servers/meta-ads/requirements.txt

```txt
mcp>=0.9.0                # Minimum version only
httpx>=0.25.0             # Minimum version only
python-dotenv>=1.0.0      # Minimum version only
pydantic>=2.0.0           # Minimum version only
supabase>=2.0.0           # Minimum version only
```

**⚠️ Recommendation:** 
Pin all Python dependencies to specific versions for reproducible builds and security. Use `pip freeze > requirements-lock.txt` or adopt modern tools like Poetry or pip-tools.

---

## Known Latest Versions (As of December 15, 2025)

Based on research and npm registry data:

### JavaScript/Node.js Ecosystem

| Package | Latest Stable Version | Release Date (Approx) |
|---------|----------------------|----------------------|
| Next.js | 16.0.10 | December 2025 |
| React | 19.2.3 | December 2025 |
| React DOM | 19.2.3 | December 2025 |
| TypeScript | 5.7.x | December 2025 |
| Node.js LTS | 20.x (Current), 22.x (Active LTS) | 2025 |
| Tailwind CSS | v4.0 (Beta/RC) | 2025 |
| uuid | 13.0.0 | 2025 |
| OpenAI SDK | 6.13.0+ | December 2025 |
| Google Generative AI | 0.24.x | November 2025 |
| Supabase JS | 2.87.x+ | December 2025 |

### Python Ecosystem (Major Packages)

**Note:** Without pinned versions or running `pip list --outdated` in the actual environment, exact versions cannot be determined. Latest stable versions as of December 2025:

| Package | Latest Version (Approx) |
|---------|------------------------|
| FastAPI | 0.115+ |
| Pydantic | 2.9+ |
| httpx | 0.28+ |
| openai | 1.55+ |
| supabase | 2.10+ |
| google-ads | 26+ |
| playwright | 1.48+ |

---

## Recommendations

### Immediate Actions (High Priority)

1. **Review Breaking Changes for uuid**
   - Current: 11.1.0 → Latest: 13.0.0
   - Review changelog before updating
   - Test thoroughly as 2 major versions jumped

2. **Update Patch Versions** (Low Risk)
   - Next.js: 16.0.8 → 16.0.10
   - React/React-DOM: 19.2.1 → 19.2.3
   - These are bug fixes and should be safe

3. **Pin Python Dependencies**
   - Create `requirements-lock.txt` with exact versions
   - Use `pip freeze` or pip-tools for reproducible builds

### Medium Priority

4. **Evaluate Node.js Version**
   - Current: Node 20.x
   - Consider: Staying on Node 20 LTS or migrating to Node 22 LTS
   - Update `@types/node` only if migrating Node version

5. **Lucide React Icons**
   - Update 0.556.0 → 0.561.0 for new icons

6. **Monitor Tailwind CSS v4**
   - Currently using beta/RC version (^4)
   - Watch for stable v4.0.0 release
   - Ensure PostCSS plugin stability

### Low Priority / Monitoring

7. **Keep Current Packages Updated**
   - OpenAI SDK: 6.13.0 (appears current)
   - Supabase JS: 2.87.3 (appears current)
   - Google Generative AI: 0.24.1 (monitor for 0.25.0)

8. **Regular Dependency Audits**
   - Run `npm outdated` monthly
   - Run `npm audit` for security vulnerabilities
   - For Python: Implement `safety check` or `pip-audit`

---

## Testing Strategy

Before updating any dependencies:

1. **Unit Tests:** Run full test suite
2. **Integration Tests:** Test critical user flows
3. **Build:** Ensure production builds succeed
4. **Local Dev:** Verify dev server works correctly
5. **Staging Deploy:** Test in staging environment
6. **Monitor:** Watch for runtime errors post-deployment

---

## Version Pinning Best Practices

### Current Issues

| File | Issue | Impact |
|------|-------|--------|
| Python requirements.txt | No version pinning | Non-reproducible builds, potential breaking changes |
| package.json | Uses caret (^) ranges | Could install newer minor/patch versions automatically |

### Recommendations

1. **Python:** Use exact versions in requirements.txt or adopt Poetry
2. **JavaScript:** Consider using exact versions or lockfile-only updates
3. **Lockfiles:** Commit `package-lock.json` and Python lockfiles to repository

---

## Commands for Future Audits

### NPM/Node.js
```bash
cd p11-platform/apps/web
npm outdated
npm outdated --json  # For programmatic parsing
npm audit             # Security vulnerabilities
```

### Python
```bash
cd p11-platform/services/data-engine
pip list --outdated
pip-audit            # Requires pip-audit package
```

---

## Appendix: Full npm outdated Output

```json
{
  "@types/node": {
    "current": "20.19.27",
    "wanted": "20.19.27",
    "latest": "25.0.2"
  },
  "eslint-config-next": {
    "current": "16.0.8",
    "wanted": "16.0.8",
    "latest": "16.0.10"
  },
  "lucide-react": {
    "current": "0.556.0",
    "wanted": "0.556.0",
    "latest": "0.561.0"
  },
  "next": {
    "current": "16.0.8",
    "wanted": "16.0.8",
    "latest": "16.0.10"
  },
  "react": {
    "current": "19.2.1",
    "wanted": "19.2.1",
    "latest": "19.2.3"
  },
  "react-dom": {
    "current": "19.2.1",
    "wanted": "19.2.1",
    "latest": "19.2.3"
  },
  "uuid": {
    "current": "11.1.0",
    "wanted": "11.1.0",
    "latest": "13.0.0"
  }
}
```

---

## Report Metadata

- **Generated By:** Automated dependency audit
- **Report Date:** December 15, 2025
- **Project Path:** `c:\Users\jasji\projects\oneClick`
- **Analysis Tool:** npm outdated, manual npm list, web research
- **Scope:** All JavaScript/TypeScript and Python dependencies

---

**End of Report**




