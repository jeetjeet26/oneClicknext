import { buildSiteForgeVerticalQualificationReport } from '../utils/siteforge/verticals/qualification'

const report = buildSiteForgeVerticalQualificationReport()
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (!report.passed) process.exitCode = 1
