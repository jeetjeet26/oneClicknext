import type { AuditContext } from './use-audit-decisions';
import type { Database } from '@/types/supabase';
import { type PropertyAuditSeedKeyword } from './seed-keywords';
import { buildComparisonQueryText } from './query-text';
import { getPropertyTypeConfig } from '@/utils/property-types';
type GeoQueryInsert = Database['public']['Tables']['geo_queries']['Insert'];
function capitalizeForPrompt(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
export function generateAuditQueryProposal(context: AuditContext, seedKeywords: PropertyAuditSeedKeyword[] = []): GeoQueryInsert[] {
    const property = context.property, propertyId = property.id;
    // Extract address components with fallbacks
    const addressObj = property.address as {
        city?: string;
        state?: string;
        street?: string;
        neighborhood?: string;
        zip?: string;
    } | null;
    const city = addressObj?.city || 'Unknown City';
    const state = addressObj?.state || '';
    const cityState = state ? `${city}, ${state}` : city;
    const neighborhood = addressObj?.neighborhood || city;
    const street = addressObj?.street || '';
    const competitors = context.competitors.map(c => ({ ...c, brand_intel: null as {
            confidence_score?: number;
            last_analyzed_at?: string;
        } | null }));
    const brandData = context.brand;
    const propertyName = property.name;
    const amenities = property.amenities || [];
    const specialFeatures = property.special_features || [];
    const propertyTypeConfig = getPropertyTypeConfig(property.property_type);
    const propertyType = propertyTypeConfig.searchNouns[0];
    const secondaryPropertyType = propertyTypeConfig.searchNouns[1] || propertyType;
    const tertiaryPropertyType = propertyTypeConfig.searchNouns[2] || secondaryPropertyType;
    const displayNoun = propertyTypeConfig.displayNoun;
    const pluralDisplayNoun = propertyTypeConfig.pluralDisplayNoun;
    const isForSaleResidential = propertyTypeConfig.isForSaleResidential;
    const topAmenityCombos = amenities.length >= 2
        ? generateAmenityCombinations(amenities, neighborhood, propertyId, cityState, propertyType).slice(0, 2)
        : [];
    const uspQueries = Array.isArray(brandData?.unique_selling_points)
        ? brandData.unique_selling_points
            .filter((usp): usp is string => typeof usp === 'string' && usp.trim().length > 0)
            .map(usp => generateUSPQuery(usp, neighborhood, propertyType))
            .filter((query): query is string => typeof query === 'string' && query.length > 0)
            .slice(0, 2)
        : [];
    const featureQueries = specialFeatures.length > 0
        ? generateSpecialFeatureQueries(specialFeatures, neighborhood, propertyId, cityState, propertyType).slice(0, 2)
        : [];
    const structuredComparisonTargets = (competitors || [])
        .map(entry => {
        const brandIntel = Array.isArray(entry.brand_intel)
            ? entry.brand_intel[0]
            : entry.brand_intel;
        return {
            name: entry.name,
            confidence: Number(brandIntel?.confidence_score ?? 0),
            analyzedAt: brandIntel?.last_analyzed_at ? Date.parse(brandIntel.last_analyzed_at) : 0,
        };
    })
        .filter((entry): entry is {
        name: string;
        confidence: number;
        analyzedAt: number;
    } => typeof entry.name === 'string' && entry.name.length > 0)
        .sort((a, b) => (b.confidence - a.confidence) || (b.analyzedAt - a.analyzedAt))
        .map(entry => entry.name);
    const comparisonTargets = Array.from(new Set([
        ...structuredComparisonTargets,
    ]));
    const seedPrompts = buildSeedKeywordPrompts({
        seeds: seedKeywords,
        propertyId,
        city,
        cityState,
        neighborhood,
        propertyType,
        pluralDisplayNoun,
        enrichedCompetitorNames: comparisonTargets,
    });
    const amenityAndUspPrompts = [
        ...topAmenityCombos,
        ...uspQueries.map(text => ({
            property_id: propertyId,
            text,
            type: 'category' as const,
            geo: cityState,
            weight: 1.4,
            run_count: 1,
            is_active: true,
        })),
        ...featureQueries,
        {
            property_id: propertyId,
            text: `${capitalizeForPrompt(pluralDisplayNoun)} with premium amenities in ${neighborhood}`,
            type: 'category' as const,
            geo: cityState,
            weight: 1.3,
            run_count: 1,
            is_active: true,
        },
        {
            property_id: propertyId,
            text: `${capitalizeForPrompt(pluralDisplayNoun)} with modern features in ${neighborhood}`,
            type: 'category' as const,
            geo: cityState,
            weight: 1.3,
            run_count: 1,
            is_active: true,
        },
        {
            property_id: propertyId,
            text: `Amenity-rich ${pluralDisplayNoun} in ${cityState}`,
            type: 'category' as const,
            geo: cityState,
            weight: 1.2,
            run_count: 1,
            is_active: true,
        },
        {
            property_id: propertyId,
            text: `${capitalizeForPrompt(pluralDisplayNoun)} with standout amenities in ${neighborhood}`,
            type: 'category' as const,
            geo: cityState,
            weight: 1.2,
            run_count: 1,
            is_active: true,
        },
    ];
    const generated: GeoQueryInsert[] = [
        // 4 branded prompts
        { property_id: propertyId, text: `What is ${propertyName}?`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
        { property_id: propertyId, text: `Is ${propertyName} a good place to live?`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
        { property_id: propertyId, text: `${propertyName} reviews`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
        { property_id: propertyId, text: `${propertyName} ${displayNoun}`, type: 'branded', geo: cityState, weight: 1.5, run_count: 1, is_active: true },
        // Category / consideration prompts. Seeded panels reserve room for top
        // keyword-derived discovery prompts without crowding out comparisons.
        { property_id: propertyId, text: `Best ${propertyType} in ${city}`, type: 'category', geo: cityState, weight: 0.8, run_count: 1, is_active: true },
        { property_id: propertyId, text: `Best ${propertyType} in ${neighborhood}`, type: 'category', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
        { property_id: propertyId, text: `Modern ${secondaryPropertyType} in ${neighborhood}`, type: 'category', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
        { property_id: propertyId, text: `Luxury ${propertyType} near ${neighborhood}`, type: 'category', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
        ...(seedPrompts.length > 0
            ? seedPrompts.slice(0, 3)
            : [
                { property_id: propertyId, text: `Top rated ${tertiaryPropertyType} in ${cityState}`, type: 'category' as const, geo: cityState, weight: 1.0, run_count: 1, is_active: true },
                { property_id: propertyId, text: `${secondaryPropertyType} near ${street || neighborhood}`, type: 'category' as const, geo: cityState, weight: 1.1, run_count: 1, is_active: true },
            ]),
        // Amenity / USP prompts
        ...amenityAndUspPrompts.slice(0, seedPrompts.length > 0 ? 3 : 4),
        // 3 local-intent prompts
        { property_id: propertyId, text: `Best place to live in ${neighborhood}`, type: 'local', geo: cityState, weight: 1.3, run_count: 1, is_active: true },
        { property_id: propertyId, text: `${neighborhood} ${pluralDisplayNoun}`, type: 'local', geo: cityState, weight: 1.3, run_count: 1, is_active: true },
        { property_id: propertyId, text: isForSaleResidential ? `Moving to ${neighborhood} - new home recommendations` : `Moving to ${neighborhood} - apartment recommendations`, type: 'local', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
        // Comparison prompts for all prioritized competitors in the panel.
        ...buildComparisonPrompts(propertyId, propertyName, comparisonTargets, cityState, neighborhood, pluralDisplayNoun, propertyType),
        // 2 decision-stage prompts
        { property_id: propertyId, text: `How much does it cost to live at ${propertyName}?`, type: 'faq', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
        { property_id: propertyId, text: isForSaleResidential ? `How do I buy at ${propertyName}?` : `How do I apply to ${propertyName}?`, type: 'faq', geo: cityState, weight: 1.2, run_count: 1, is_active: true },
        // 2 support / voice-style prompts
        { property_id: propertyId, text: `Tell me about ${propertyName}`, type: 'voice_search', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
        { property_id: propertyId, text: `What amenities does ${propertyName} have?`, type: 'voice_search', geo: cityState, weight: 1.1, run_count: 1, is_active: true },
    ];
    const deduped = new Map<string, GeoQueryInsert>();
    for (const generatedQuery of generated) {
        const key = generatedQuery.text.trim().toLowerCase();
        if (!deduped.has(key)) {
            deduped.set(key, generatedQuery);
        }
    }
    const fallbackAmenityOrFeature = amenityAndUspPrompts;
    for (const queryText of uspQueries.slice(2)) {
        if (deduped.size >= 24)
            break;
        deduped.set(queryText.toLowerCase(), {
            property_id: propertyId,
            text: queryText,
            type: 'category',
            geo: cityState,
            weight: 1.4,
            run_count: 1,
            is_active: true,
        });
    }
    for (const generatedQuery of seedPrompts.slice(3)) {
        if (deduped.size >= 24)
            break;
        deduped.set(generatedQuery.text.toLowerCase(), generatedQuery);
    }
    for (const generatedQuery of fallbackAmenityOrFeature) {
        if (deduped.size >= 24)
            break;
        deduped.set(generatedQuery.text.toLowerCase(), generatedQuery);
    }
    const finalFallbacks: GeoQueryInsert[] = [
        {
            property_id: propertyId,
            text: `${propertyName} pricing`,
            type: 'faq',
            geo: cityState,
            weight: 1.1,
            run_count: 1,
            is_active: true,
        },
        {
            property_id: propertyId,
            text: isForSaleResidential ? `${propertyName} purchase process` : `${propertyName} application process`,
            type: 'faq',
            geo: cityState,
            weight: 1.1,
            run_count: 1,
            is_active: true,
        },
        {
            property_id: propertyId,
            text: isForSaleResidential ? `Best ${propertyType} in ${cityState}` : `Best apartments for renters in ${cityState}`,
            type: 'category',
            geo: cityState,
            weight: 1.0,
            run_count: 1,
            is_active: true,
        },
        {
            property_id: propertyId,
            text: isForSaleResidential ? `Where should I buy a new home in ${neighborhood}?` : `Where should I rent in ${neighborhood}?`,
            type: 'voice_search',
            geo: cityState,
            weight: 1.1,
            run_count: 1,
            is_active: true,
        },
    ];
    for (const generatedQuery of finalFallbacks) {
        if (deduped.size >= 24)
            break;
        deduped.set(generatedQuery.text.toLowerCase(), generatedQuery);
    }
    return Array.from(deduped.values());
}
function buildSeedKeywordPrompts(args: {
    seeds: PropertyAuditSeedKeyword[];
    propertyId: string;
    city: string;
    cityState: string;
    neighborhood: string;
    propertyType: string;
    pluralDisplayNoun: string;
    enrichedCompetitorNames: string[];
}): GeoQueryInsert[] {
    const competitorNameFragments = args.enrichedCompetitorNames
        .map(name => name.toLowerCase().trim())
        .filter(name => name.length >= 3);
    const prompts: GeoQueryInsert[] = [];
    for (const seed of args.seeds) {
        const keyword = seed.keyword.trim();
        const keywordLower = keyword.toLowerCase();
        if (!keyword)
            continue;
        if (competitorNameFragments.some(name => keywordLower.includes(name))) {
            continue;
        }
        const hasLocalIntent = keywordLower.includes('near me') ||
            keywordLower.includes(args.city.toLowerCase()) ||
            keywordLower.includes(args.neighborhood.toLowerCase());
        const hasPropertyType = keywordLower.includes(args.propertyType.toLowerCase()) ||
            keywordLower.includes(args.pluralDisplayNoun.toLowerCase());
        prompts.push({
            property_id: args.propertyId,
            text: hasPropertyType || hasLocalIntent ? keyword : `${keyword} ${args.pluralDisplayNoun}`,
            type: hasLocalIntent ? 'local' : 'category',
            geo: args.cityState,
            weight: seed.score > 0 ? 1.45 : 1.25,
            run_count: 1,
            is_active: true,
        });
    }
    const deduped = new Map<string, GeoQueryInsert>();
    for (const prompt of prompts) {
        deduped.set(prompt.text.toLowerCase(), prompt);
        if (deduped.size >= 8)
            break;
    }
    return Array.from(deduped.values());
}
function buildComparisonPrompts(propertyId: string, propertyName: string, competitors: string[], cityState: string, neighborhood: string, pluralDisplayNoun: string, primarySearchTerm: string): GeoQueryInsert[] {
    const prompts = competitors.map((competitor) => ({
        property_id: propertyId,
        text: buildComparisonQueryText({
            propertyName,
            competitorName: competitor,
            cityState,
            pluralDisplayNoun,
        }),
        type: 'comparison' as const,
        geo: cityState,
        weight: 1.3,
        run_count: 1,
        is_active: true,
    }));
    while (prompts.length < 3) {
        const fallbackCompetitor = prompts.length === 0
            ? `${primarySearchTerm} in ${neighborhood}`
            : prompts.length === 1
                ? `luxury ${primarySearchTerm} in ${cityState}`
                : `nearby ${pluralDisplayNoun}`;
        prompts.push({
            property_id: propertyId,
            text: buildComparisonQueryText({
                propertyName,
                competitorName: fallbackCompetitor,
                cityState,
                pluralDisplayNoun,
            }),
            type: 'comparison',
            geo: cityState,
            weight: 1.2,
            run_count: 1,
            is_active: true,
        });
    }
    return prompts;
}
/**
 * Generate amenity combination queries
 * Creates long-tail queries with 2-3 amenity combinations
 */
function generateAmenityCombinations(amenities: string[], neighborhood: string, propertyId: string, cityState: string, primarySearchTerm: string): GeoQueryInsert[] {
    const combos: Array<{
        text: string;
        weight: number;
    }> = [];
    // Normalize amenity names
    const normalized = amenities.map(a => a.toLowerCase());
    // Common amenity keywords for better query construction
    const amenityMap: Record<string, string> = {
        pool: 'pool',
        'swimming pool': 'pool',
        gym: 'fitness center',
        fitness: 'fitness center',
        'fitness center': 'fitness center',
        pet: 'pet-friendly',
        dog: 'dog-friendly',
        'pet friendly': 'pet-friendly',
        'dog park': 'dog park',
        parking: 'parking',
        garage: 'garage parking',
        rooftop: 'rooftop',
        'rooftop deck': 'rooftop deck',
        coworking: 'coworking space',
        'ev charging': 'EV charging',
        'electric vehicle': 'EV charging',
        concierge: 'concierge',
        'smart home': 'smart home technology',
        spa: 'spa',
        'package locker': 'package lockers',
        'bike storage': 'bike storage',
    };
    // Extract key amenities
    const keyAmenities: string[] = [];
    for (const amenity of normalized) {
        for (const [key, value] of Object.entries(amenityMap)) {
            if (amenity.includes(key) && !keyAmenities.includes(value)) {
                keyAmenities.push(value);
                break;
            }
        }
    }
    // Generate 2-amenity combinations
    if (keyAmenities.length >= 2) {
        for (let i = 0; i < Math.min(keyAmenities.length - 1, 3); i++) {
            for (let j = i + 1; j < Math.min(keyAmenities.length, 4); j++) {
                combos.push({
                    text: `${capitalizeForPrompt(primarySearchTerm)} with ${keyAmenities[i]} and ${keyAmenities[j]} in ${neighborhood}`,
                    weight: 1.4,
                });
                if (combos.length >= 6)
                    break;
            }
            if (combos.length >= 6)
                break;
        }
    }
    // Generate 3-amenity combinations if we have room
    if (keyAmenities.length >= 3 && combos.length < 4) {
        for (let i = 0; i < Math.min(keyAmenities.length - 2, 2); i++) {
            combos.push({
                text: `${neighborhood} ${primarySearchTerm} with ${keyAmenities[i]}, ${keyAmenities[i + 1]}, and ${keyAmenities[i + 2]}`,
                weight: 1.5, // Higher weight - very specific
            });
        }
    }
    // If we have nearby landmarks or special features, add those
    if (keyAmenities.length > 0) {
        combos.push({
            text: `Modern ${primarySearchTerm} near ${neighborhood} with ${keyAmenities[0]}`,
            weight: 1.3,
        });
    }
    // Convert to full query objects (run_count included for type compatibility)
    return combos.slice(0, 6).map(combo => ({
        property_id: propertyId,
        text: combo.text,
        type: 'category' as const,
        geo: cityState,
        weight: combo.weight,
        run_count: 1,
        is_active: true,
    }));
}
function generateSpecialFeatureQueries(specialFeatures: string[], neighborhood: string, propertyId: string, cityState: string, primarySearchTerm: string): GeoQueryInsert[] {
    const normalizedFeatures = specialFeatures
        .filter((feature): feature is string => typeof feature === 'string' && feature.trim().length > 0)
        .slice(0, 3);
    return normalizedFeatures.map((feature) => ({
        property_id: propertyId,
        text: `${capitalizeForPrompt(primarySearchTerm)} in ${neighborhood} with ${feature}`,
        type: 'category' as const,
        geo: cityState,
        weight: 1.4,
        run_count: 1,
        is_active: true,
    }));
}
/**
 * Generate query from USP
 * Converts brand USP into searchable query
 */
function generateUSPQuery(usp: string, neighborhood: string, primarySearchTerm: string): string | null {
    const lowerUSP = usp.toLowerCase();
    // Extract key features from USP
    if (lowerUSP.includes('sustainable') || lowerUSP.includes('green') || lowerUSP.includes('solar')) {
        return `Sustainable green ${primarySearchTerm} in ${neighborhood} with solar power`;
    }
    if (lowerUSP.includes('luxury') || lowerUSP.includes('premium') || lowerUSP.includes('high-end')) {
        return `Premium luxury ${primarySearchTerm} in ${neighborhood}`;
    }
    if (lowerUSP.includes('tech') || lowerUSP.includes('smart home') || lowerUSP.includes('automation')) {
        return `${capitalizeForPrompt(primarySearchTerm)} with smart home technology in ${neighborhood}`;
    }
    if (lowerUSP.includes('walkable') || lowerUSP.includes('walk score')) {
        return `Walkable ${primarySearchTerm} in ${neighborhood} near shops and dining`;
    }
    if (lowerUSP.includes('view') || lowerUSP.includes('scenic')) {
        return `${capitalizeForPrompt(primarySearchTerm)} with views in ${neighborhood}`;
    }
    if (lowerUSP.includes('resort') || lowerUSP.includes('amenity')) {
        return `Resort-style ${primarySearchTerm} in ${neighborhood}`;
    }
    if (lowerUSP.includes('community') || lowerUSP.includes('social')) {
        return `${capitalizeForPrompt(primarySearchTerm)} with strong community in ${neighborhood}`;
    }
    // Generic fallback - try to extract key terms
    const words = usp.split(' ').filter(w => w.length > 4);
    if (words.length > 0) {
        return `${words[0]} ${primarySearchTerm} in ${neighborhood}`;
    }
    return null;
}
// Format query for API response
