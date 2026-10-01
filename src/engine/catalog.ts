// NIST CSF 2.0 (NIST CSWP 29, February 26, 2024) — 25-subcategory educational subset.
// Subcategory identifiers and outcome statements transcribed from https://doi.org/10.6028/NIST.CSWP.29
// (U.S. Government work, not subject to copyright in the United States). This is a subset, not the full Core (106 subcategories).
import type { Subcategory } from './types';

export const CSF_VERSION = 'NIST CSF 2.0 (CSWP 29, 2024-02-26)';
export const SUBSET_LABEL = '25 of 106 subcategories (educational subset)';

export const CATALOG: readonly Subcategory[] = [
  {"id": "GV.OC-03", "fn": "GV", "functionName": "Govern", "category": "GV.OC", "categoryName": "Organizational Context", "statement": "Legal, regulatory, and contractual requirements regarding cybersecurity — including privacy and civil liberties obligations — are understood and managed"},
  {"id": "GV.RM-02", "fn": "GV", "functionName": "Govern", "category": "GV.RM", "categoryName": "Risk Management Strategy", "statement": "Risk appetite and risk tolerance statements are established, communicated, and maintained"},
  {"id": "GV.RR-02", "fn": "GV", "functionName": "Govern", "category": "GV.RR", "categoryName": "Roles, Responsibilities, and Authorities", "statement": "Roles, responsibilities, and authorities related to cybersecurity risk management are established, communicated, understood, and enforced"},
  {"id": "GV.PO-01", "fn": "GV", "functionName": "Govern", "category": "GV.PO", "categoryName": "Policy", "statement": "Policy for managing cybersecurity risks is established based on organizational context, cybersecurity strategy, and priorities and is communicated and enforced"},
  {"id": "GV.SC-04", "fn": "GV", "functionName": "Govern", "category": "GV.SC", "categoryName": "Cybersecurity Supply Chain Risk Management", "statement": "Suppliers are known and prioritized by criticality"},
  {"id": "GV.SC-07", "fn": "GV", "functionName": "Govern", "category": "GV.SC", "categoryName": "Cybersecurity Supply Chain Risk Management", "statement": "The risks posed by a supplier, their products and services, and other third parties are understood, recorded, prioritized, assessed, responded to, and monitored over the course of the relationship"},
  {"id": "ID.AM-01", "fn": "ID", "functionName": "Identify", "category": "ID.AM", "categoryName": "Asset Management", "statement": "Inventories of hardware managed by the organization are maintained"},
  {"id": "ID.AM-02", "fn": "ID", "functionName": "Identify", "category": "ID.AM", "categoryName": "Asset Management", "statement": "Inventories of software, services, and systems managed by the organization are maintained"},
  {"id": "ID.RA-01", "fn": "ID", "functionName": "Identify", "category": "ID.RA", "categoryName": "Risk Assessment", "statement": "Vulnerabilities in assets are identified, validated, and recorded"},
  {"id": "ID.RA-05", "fn": "ID", "functionName": "Identify", "category": "ID.RA", "categoryName": "Risk Assessment", "statement": "Threats, vulnerabilities, likelihoods, and impacts are used to understand inherent risk and inform risk response prioritization"},
  {"id": "ID.IM-02", "fn": "ID", "functionName": "Identify", "category": "ID.IM", "categoryName": "Improvement", "statement": "Improvements are identified from security tests and exercises, including those done in coordination with suppliers and relevant third parties"},
  {"id": "PR.AA-01", "fn": "PR", "functionName": "Protect", "category": "PR.AA", "categoryName": "Identity Management, Authentication, and Access Control", "statement": "Identities and credentials for authorized users, services, and hardware are managed by the organization"},
  {"id": "PR.AA-05", "fn": "PR", "functionName": "Protect", "category": "PR.AA", "categoryName": "Identity Management, Authentication, and Access Control", "statement": "Access permissions, entitlements, and authorizations are defined in a policy, managed, enforced, and reviewed, and incorporate the principles of least privilege and separation of duties"},
  {"id": "PR.AT-01", "fn": "PR", "functionName": "Protect", "category": "PR.AT", "categoryName": "Awareness and Training", "statement": "Personnel are provided with awareness and training so that they possess the knowledge and skills to perform general tasks with cybersecurity risks in mind"},
  {"id": "PR.DS-01", "fn": "PR", "functionName": "Protect", "category": "PR.DS", "categoryName": "Data Security", "statement": "The confidentiality, integrity, and availability of data-at-rest are protected"},
  {"id": "PR.DS-11", "fn": "PR", "functionName": "Protect", "category": "PR.DS", "categoryName": "Data Security", "statement": "Backups of data are created, protected, maintained, and tested"},
  {"id": "PR.PS-01", "fn": "PR", "functionName": "Protect", "category": "PR.PS", "categoryName": "Platform Security", "statement": "Configuration management practices are established and applied"},
  {"id": "PR.PS-02", "fn": "PR", "functionName": "Protect", "category": "PR.PS", "categoryName": "Platform Security", "statement": "Software is maintained, replaced, and removed commensurate with risk"},
  {"id": "PR.IR-01", "fn": "PR", "functionName": "Protect", "category": "PR.IR", "categoryName": "Technology Infrastructure Resilience", "statement": "Networks and environments are protected from unauthorized logical access and usage"},
  {"id": "DE.CM-01", "fn": "DE", "functionName": "Detect", "category": "DE.CM", "categoryName": "Continuous Monitoring", "statement": "Networks and network services are monitored to find potentially adverse events"},
  {"id": "DE.AE-02", "fn": "DE", "functionName": "Detect", "category": "DE.AE", "categoryName": "Adverse Event Analysis", "statement": "Potentially adverse events are analyzed to better understand associated activities"},
  {"id": "RS.MA-01", "fn": "RS", "functionName": "Respond", "category": "RS.MA", "categoryName": "Incident Management", "statement": "The incident response plan is executed in coordination with relevant third parties once an incident is declared"},
  {"id": "RS.AN-03", "fn": "RS", "functionName": "Respond", "category": "RS.AN", "categoryName": "Incident Analysis", "statement": "Analysis is performed to establish what has taken place during an incident and the root cause of the incident"},
  {"id": "RC.RP-01", "fn": "RC", "functionName": "Recover", "category": "RC.RP", "categoryName": "Incident Recovery Plan Execution", "statement": "The recovery portion of the incident response plan is executed once initiated from the incident response process"},
  {"id": "RC.CO-03", "fn": "RC", "functionName": "Recover", "category": "RC.CO", "categoryName": "Incident Recovery Communication", "statement": "Recovery activities and progress in restoring operational capabilities are communicated to designated internal and external stakeholders"},
];

export const CATALOG_IDS: ReadonlySet<string> = new Set(CATALOG.map((s) => s.id));
