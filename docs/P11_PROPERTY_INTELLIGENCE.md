# P11 Property Intelligence

Today’s additions give the team a more connected way to keep property information accurate, use it to generate websites, understand performance, and record whether improvements worked.

**Status as of October 7, 2026: built and tested locally. These additions have not been deployed to the live console.**

1. **A shared record of approved property information**

   The team can save property descriptions, selling points, amenities, policies, contact details and other facts, along with where the information came from and when it needs reviewing. Changes retain a history. This gives website generation and reporting a more dependable source of information.

2. **Website generation inside the console using Astra**

   SiteForge can use saved property information, approved floorplans and assets to generate a finished website package directly in the console. The package includes website files, assets and installation/editing instructions. There is no separate Codex handoff. WordPress and standalone websites are supported; Webflow currently receives a content export only.

   The team can also save creative direction—colors, typography, imagery, tone and design references—and approve it for generation. Reusable P11 website component guidance helps keep the output consistent. When source information changes, the team can generate an updated package; live websites are not automatically changed or published.

3. **A way to bring performance information together**

   We added support for Google Search Console data and reviewed spreadsheet imports. Search Console can supply website visibility and clicks from Google search, once connected. Imported information is reviewed before it appears in client insights. **No live data account has been activated. CallRail and Buildium are deferred.**

4. **Insights for the internal team and clients**

   Internal members can review available performance information, missing data, recorded inquiry outcomes and comparisons across properties. Clients get a read-only Insights page for their assigned properties, with internal notes and references kept private.

   The team can ask supported plain-English questions about recorded performance and comparisons. Answers depend on the information available; this does not forecast results or prove what caused a change.

5. **Recommendations linked to evidence and results**

   The team can record a proposed improvement, why it is worth trying, who is responsible and how success will be measured. It can then link the work performed and the observed result. Basecamp remains the place for project management. Approving a recommendation does not automatically carry it out.

6. **A structured way to evaluate experiments**

   The team can define a test before it starts, record what will be measured and review the results afterward. The system checks the supplied data and preserves the result. It does not automatically split website traffic, choose a winner or roll out changes.

We verified the local build, automated checks, client access restrictions and key browser workflows. We also generated and downloaded a real Astra website using saved, approved property information and creative direction.

Production deployment, live data connections, autonomous agency planning/execution and model training remain deferred. Historical outcome backfill and the Acacia calendar repair are also separate outstanding work. This work does not establish new proof that a lease was signed; recorded outcomes still require appropriate verification.

[Technical implementation and testing reference](P11_PROPERTY_INTELLIGENCE_TECHNICAL.md)
