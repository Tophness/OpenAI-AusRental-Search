document.addEventListener('DOMContentLoaded', () => {
    const PROXY_BASE_URL = 'https://openai-ausrental-search-d3ys.onrender.com';

    // --- UI Elements ---
	const filterPropertyTypeSelect = document.getElementById('filter-property-type');
    const tabs = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const loadingMessageDiv = document.getElementById('loading-message'); // Updated ID
    const errorDiv = document.getElementById('error-message');
    const resultsContainer = document.getElementById('results-container');
    const paginationControls = document.getElementById('pagination-controls');
    const prevPageButton = document.getElementById('prev-page');
    const nextPageButton = document.getElementById('next-page');
    const pageInfoSpan = document.getElementById('page-info');

    const filterAddressInput = document.getElementById('filter-address');
    const filterDescriptionInput = document.getElementById('filter-description');
    const sortResultsSelect = document.getElementById('sort-results');

    // --- State Variables ---
    let currentApiSource = 'domain';
    let allFetchedListings = []; // Store all listings from all pages + descriptions
    let processedListings = []; // Listings after filtering and sorting
    
    let clientSideCurrentPage = 1;
    const CLIENT_SIDE_ITEMS_PER_PAGE = 10; // Or make this configurable

    // Rate Limiting for description fetching (user configurable - constants for now)
    const DESCRIPTION_FETCH_DELAY_MS = 100; // 0.1 second delay between fetches
    const DESCRIPTION_FETCH_BATCH_SIZE = 10; // Process 10, then apply a longer delay if needed. Or just delay every N. Let's use 1s every 100 results as requested.
    const BULK_DELAY_MS = 1000;
    const BULK_DELAY_BATCH_SIZE = 100; // Wait 1 second every 100 description fetches

    let initialFormData = null; // To store the primary form data

    // --- Helper: Debounce ---
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }
    
    // --- Tab Switching ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
            currentApiSource = tab.dataset.tab;
            clearResultsAndState();
        });
    });

    function clearResultsAndState() {
        allFetchedListings = [];
        processedListings = [];
        resultsContainer.innerHTML = '';
        paginationControls.style.display = 'none';
        errorDiv.style.display = 'none';
        loadingMessageDiv.style.display = 'none';
        clientSideCurrentPage = 1;
		filterPropertyTypeSelect.innerHTML = '<option value="">All Types</option>';
		filterPropertyTypeSelect.value = "";
    }

    // --- Form Submission ---
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            clearResultsAndState();
            initialFormData = new FormData(form);
            fetchAllDataProcess();
        });
    });

    // --- Event Listeners for Filters and Sort ---
	filterPropertyTypeSelect.addEventListener('change', processAndDisplayListings);
    filterAddressInput.addEventListener('input', debounce(processAndDisplayListings, 500));
    filterDescriptionInput.addEventListener('input', debounce(processAndDisplayListings, 500));
    sortResultsSelect.addEventListener('change', processAndDisplayListings);


	function populateAndSetPropertyTypeFilter(apiSource, listings) {
		filterPropertyTypeSelect.innerHTML = '<option value="">All Types</option>'; // Clear existing and add default "All"
		const availableTypes = new Set();

		listings.forEach(listing => {
			let type = '';
			switch (apiSource) {
				case 'domain':
					type = listing.features?.propertyTypeFormatted;
					break;
				case 'rentdc':
					type = listing.propType;
					break;
				case 'realestate':
					type = listing.propertyType;
					break;
				case 'flatmates':
					// Flatmates doesn't have a direct "property type" like the others in its listings.
					// It has "rooms" (e.g., "Private room in share house") or categories like "Whole property".
					// You might need to infer or map these if you want a similar filter.
					// For now, we'll skip populating from Flatmates data directly for simplicity.
					// You could add predefined options for Flatmates if desired (e.g. "Share House", "Studio", "Whole Property")
					// and then filter based on keywords in listing.rooms or other fields.
					if (listing.rooms?.toLowerCase().includes('share house')) type = 'Share House';
					else if (listing.rooms?.toLowerCase().includes('studio')) type = 'Studio';
					// Add more mappings for flatmates if needed
					break;
			}
			if (type && typeof type === 'string' && type.trim() !== '') {
				availableTypes.add(type.trim());
			}
		});

		// Add predefined types if the API is Flatmates and no dynamic types were found
		if (apiSource === 'flatmates' && availableTypes.size === 0) {
			['Share House', 'Studio', 'Whole Property', 'Granny Flat'].forEach(t => availableTypes.add(t));
		}


		Array.from(availableTypes).sort().forEach(type => {
			const option = document.createElement('option');
			option.value = type;
			option.textContent = type;
			filterPropertyTypeSelect.appendChild(option);
		});

		// Set default for Domain
		if (apiSource === 'domain') {
			const defaultDomainType = "Acreage / Semi-Rural";
			// Check if the default type is in the dynamically populated options
			let foundDefault = false;
			for (let i = 0; i < filterPropertyTypeSelect.options.length; i++) {
				if (filterPropertyTypeSelect.options[i].value === defaultDomainType) {
					filterPropertyTypeSelect.value = defaultDomainType;
					foundDefault = true;
					break;
				}
			}
			// If the default type wasn't found in results, add it and select it
			if (!foundDefault) {
				const option = document.createElement('option');
				option.value = defaultDomainType;
				option.textContent = defaultDomainType;
				filterPropertyTypeSelect.appendChild(option); // Add it to the end
				filterPropertyTypeSelect.value = defaultDomainType; // Then select it
			}
		} else {
			filterPropertyTypeSelect.value = ""; // Default to "All Types" for others
		}
	}

    // --- Main Data Fetching and Processing Logic ---
    async function fetchAllDataProcess() {
        if (!initialFormData && document.getElementById(`${currentApiSource}-form`)) { // Check if initialFormData is set, if not, try to get it from current form
            initialFormData = new FormData(document.getElementById(`${currentApiSource}-form`));
        } else if (!initialFormData) { // If still no initialFormData (e.g. form doesn't exist, unlikely here)
             showError("Form data is not available. Please submit a search.");
             return;
        }


        loadingMessageDiv.textContent = 'Fetching initial listings...';
        loadingMessageDiv.style.display = 'block';
        errorDiv.style.display = 'none';

        let listingsFromApi = [];
        let currentPageForApi = 1;
        let hasMorePages = true;

        try {
            while (hasMorePages) {
                loadingMessageDiv.textContent = `Fetching listings (API Page ${currentPageForApi})...`;
                
                // --- CORRECTED FormData HANDLING ---
                let formDataForPage;
                if (initialFormData) {
                    formDataForPage = new FormData(); // Create a new empty FormData
                    // Copy entries from initialFormData
                    for (const [key, value] of initialFormData.entries()) {
                        formDataForPage.append(key, value);
                    }
                } else { 
                    // This case should be less likely now due to the check at the beginning of the function,
                    // but as a fallback, try to get it from the current form if initialFormData was somehow cleared.
                    const currentFormElement = document.getElementById(`${currentApiSource}-form`);
                    if (currentFormElement) {
                        formDataForPage = new FormData(currentFormElement);
                    } else {
                        throw new Error("Could not retrieve form data for API request.");
                    }
                }
                // --- END CORRECTED FormData HANDLING ---
                
                // Update page number for the API request
                if (formDataForPage.has('page')) {
                    formDataForPage.set('page', currentPageForApi);
                } else {
                    formDataForPage.append('page', currentPageForApi);
                }
                
                const apiResponse = await makeApiRequest(currentApiSource, formDataForPage);

                // ... (rest of the while loop logic for processing apiResponse and determining hasMorePages)
                // ... (This part from the previous correct answer should be fine)

                let newPageListings = [];
                switch (currentApiSource) {
                    case 'domain':
                        newPageListings = apiResponse.listings ? Object.values(apiResponse.listings).map(l => ({ ...l.listingModel, original_api_source: 'domain' })) : [];
                        hasMorePages = currentPageForApi < (apiResponse.totalPages || 1);
                        if (currentPageForApi === 1 && newPageListings.length === 0 && (apiResponse.totalListings === 0 || Object.keys(apiResponse.listings || {}).length === 0)) {
                            // If it's the first page and absolutely no results, stop.
                            hasMorePages = false;
                        }
                        break;
                    case 'rentdc':
                        newPageListings = (apiResponse.listings || []).map(l => ({ ...l, original_api_source: 'rentdc' }));
                        hasMorePages = currentPageForApi < Math.ceil((apiResponse.totalListings || 0) / 20);
                        if (apiResponse.nextPageNum && apiResponse.nextPageNum <= currentPageForApi) hasMorePages = false;
                        if (currentPageForApi === 1 && newPageListings.length === 0 && apiResponse.totalListings === 0) {
                            hasMorePages = false;
                        }
                        break;
                    case 'realestate':
                        newPageListings = (apiResponse.listings || []).map(l => ({ ...l, original_api_source: 'realestate' }));
                        const pageSizeRea = parseInt(formDataForPage.get('pageSize') || '20');
                        hasMorePages = currentPageForApi < Math.ceil((apiResponse.totalListings || 0) / pageSizeRea);
                         if (currentPageForApi === 1 && newPageListings.length === 0 && apiResponse.totalListings === 0) {
                            hasMorePages = false;
                        }
                        break;
                    case 'flatmates':
                        newPageListings = (apiResponse.listings || []).map(l => ({ ...l, original_api_source: 'flatmates' }));
                        hasMorePages = !!apiResponse.nextPage;
                        if (currentPageForApi === 1 && newPageListings.length === 0 && !apiResponse.nextPage) { // if no listings on page 1 and no next page
                            hasMorePages = false;
                        }
                        break;
                }
                
                if (newPageListings.length === 0 && currentPageForApi > 1) { 
                     hasMorePages = false;
                } else if (newPageListings.length > 0) {
                    listingsFromApi.push(...newPageListings);
                }


                if (hasMorePages) {
                    currentPageForApi++;
                } else {
                    break; 
                }
                 if (currentPageForApi > 50) { 
                    console.warn("Safety break: Exceeded 50 pages for API fetch.");
                    hasMorePages = false;
                }
            } // End of while loop
            
            allFetchedListings = listingsFromApi;

            if (allFetchedListings.length === 0) {
                loadingMessageDiv.textContent = 'No listings found from the API.';
                 // No need to fetch descriptions if no primary listings
                processAndDisplayListings(); // This will show "No listings match..."
                return; // Exit early
            }


            if (currentApiSource === 'domain' || currentApiSource === 'rentdc') {
                await fetchAndScrapeDescriptions(allFetchedListings, currentApiSource);
            }

			populateAndSetPropertyTypeFilter(currentApiSource, allFetchedListings);
            processAndDisplayListings();

        } catch (error) {
            console.error('Error in fetchAllDataProcess:', error);
            showError(`Failed during data fetching: ${error.message}`);
        } finally {
            if (allFetchedListings.length > 0) { // Only hide loading if we actually processed something
                loadingMessageDiv.style.display = 'none';
            }
        }
    }
    
    async function makeApiRequest(apiSource, formData) {
        let url;
        const params = new URLSearchParams();
        for (const [key, value] of formData.entries()) {
            if (value !== null && value !== '' && value !== undefined) {
                params.append(key, value);
            }
        }
        const queryString = params.toString();

        switch (apiSource) {
            case 'domain':
                url = `${PROXY_BASE_URL}/domain/?${queryString}`;
                break;
            case 'rentdc':
                const suburbs = formData.get('suburbs');
                if (!suburbs) throw new Error("Suburbs are required for Rent.com.au");
                const rentDcParams = new URLSearchParams(params);
                rentDcParams.delete('suburbs');
                url = `${PROXY_BASE_URL}/rentdc/${encodeURIComponent(suburbs)}?${rentDcParams.toString()}`;
                break;
            case 'realestate':
                url = `${PROXY_BASE_URL}/realestate/?${queryString}`;
                break;
            case 'flatmates':
                url = `${PROXY_BASE_URL}/flatmates/?${queryString}`;
                break;
            default:
                throw new Error('Invalid API source.');
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `HTTP error! status: ${response.status}` }));
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async function fetchAndScrapeDescriptions(listings, apiSource) {
        loadingMessageDiv.textContent = 'Fetching detailed descriptions... (0%)';
        let fetchedCount = 0;
        const totalToFetch = listings.filter(l => l.url).length;

        for (let i = 0; i < listings.length; i++) {
            const listing = listings[i];
            let pageUrl = '';

            if (apiSource === 'domain' && listing.url) {
                pageUrl = `https://www.domain.com.au${listing.url}`;
            } else if (apiSource === 'rentdc' && listing.url) {
                pageUrl = `https://www.rent.com.au${listing.url}`;
            }

            if (pageUrl) {
                try {
                    const proxyScrapeUrl = `${PROXY_BASE_URL}/scrape-html?url=${encodeURIComponent(pageUrl)}`;
                    const response = await fetch(proxyScrapeUrl);
                    if (!response.ok) {
                        console.warn(`Failed to scrape ${pageUrl}: ${response.status}`);
                        listing.scraped_description = 'Error fetching description.';
                        fetchedCount++; // Still count it as an attempt
                        continue;
                    }
                    const htmlText = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlText, 'text/html');
                    
                    let descHtmlContent = ''; // Store the relevant HTML content
                    if (apiSource === 'domain') {
                        // Try to get the content within the expander first
                        const expanderContent = doc.querySelector('div[data-testid="listing-details__description"] .noscript-expander-content');
                        if (expanderContent) {
                            descHtmlContent = expanderContent.innerHTML;
                        } else {
                            // Fallback if the expander structure isn't found (e.g., for very short descriptions)
                            const mainDescElement = doc.querySelector('div[data-testid="listing-details__description"]');
                            if (mainDescElement) {
                                // Attempt to remove the "Read more" button part to avoid including it.
                                const readMoreButtonContainer = mainDescElement.querySelector('.css-ldqj9h'); // Class of the button's div
                                if (readMoreButtonContainer) {
                                    readMoreButtonContainer.remove();
                                }
                                // Also remove the main H2 "Property Description" title if we just want the body
                                const mainTitle = mainDescElement.querySelector('h2.css-8shhfl');
                                if (mainTitle) {
                                    mainTitle.remove();
                                }
                                descHtmlContent = mainDescElement.innerHTML;
                            } else {
                                descHtmlContent = 'Description element not found on page.';
                            }
                        }
                    } else if (apiSource === 'rentdc') {
                        const descElement = doc.querySelector('p.property-description-content');
                        descHtmlContent = descElement ? descElement.outerHTML : 'Description element not found on page.'; // Use outerHTML to keep the <p> tag itself
                    }
                    listing.scraped_description = descHtmlContent;

                    fetchedCount++;
                    const percentage = totalToFetch > 0 ? Math.round((fetchedCount / totalToFetch) * 100) : 0;
                    loadingMessageDiv.textContent = `Fetching detailed descriptions... (${percentage}%) - ${fetchedCount} of ${totalToFetch}`;

                    if (fetchedCount % DESCRIPTION_FETCH_BATCH_SIZE === 0) {
                        await new Promise(resolve => setTimeout(resolve, DESCRIPTION_FETCH_DELAY_MS));
                    }
                    if (fetchedCount % BULK_DELAY_BATCH_SIZE === 0 && fetchedCount > 0) {
                        loadingMessageDiv.textContent += ` Pausing for ${BULK_DELAY_MS/1000}s...`;
                        await new Promise(resolve => setTimeout(resolve, BULK_DELAY_MS));
                    }

                } catch (err) {
                    console.error(`Error scraping description for ${pageUrl}:`, err);
                    listing.scraped_description = 'Error processing description.';
                    fetchedCount++; // Count as an attempt even on error
                }
            } else {
                // If there's no URL to fetch, it's not an attempt we count for the progress bar
                // but we should ensure scraped_description is empty or a placeholder
                listing.scraped_description = listing.scraped_description || ''; // Keep existing if somehow set, else empty
            }
        } // end of for loop
    }


    function processAndDisplayListings() {
        if (allFetchedListings.length === 0 && initialFormData) { // If no listings but form was submitted, maybe trigger fetch
             // This case might occur if filters are changed before initial search completes or if search yields no results.
             // Let's not auto-fetch here to avoid loops, user should re-submit form.
             // However, if allFetchedListings IS populated, then proceed.
        } else if (allFetchedListings.length === 0 && !initialFormData) {
            resultsContainer.innerHTML = "<p>Please perform a search first.</p>";
            paginationControls.style.display = 'none';
            return;
        }


        let currentProcessedListings = [...allFetchedListings];

        // 1. Apply Filters
        const addressFilterTerms = filterAddressInput.value.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
        const descriptionFilterTerms = filterDescriptionInput.value.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
		const selectedPropertyType = filterPropertyTypeSelect.value;

        if (addressFilterTerms.length > 0) {
            currentProcessedListings = currentProcessedListings.filter(listing => {
                const address = (listing.address || '').toLowerCase();
                return !addressFilterTerms.some(term => address.includes(term));
            });
        }

        if (descriptionFilterTerms.length > 0) {
            currentProcessedListings = currentProcessedListings.filter(listing => {
                const description = (listing.description || listing.scraped_description || '').toLowerCase();
                return !descriptionFilterTerms.some(term => description.includes(term));
            });
        }

		if (selectedPropertyType && selectedPropertyType !== "") {
			currentProcessedListings = currentProcessedListings.filter(listing => {
				let type = '';
				switch (listing.original_api_source) {
					case 'domain':
						type = listing.features?.propertyTypeFormatted;
						break;
					case 'rentdc':
						type = listing.propType;
						break;
					case 'realestate':
						type = listing.propertyType;
						break;
					case 'flatmates':
						if (selectedPropertyType === 'Share House' && listing.rooms?.toLowerCase().includes('share house')) return true;
						if (selectedPropertyType === 'Studio' && listing.rooms?.toLowerCase().includes('studio')) return true;
						if (selectedPropertyType === 'Whole Property' && listing.rooms?.toLowerCase().includes('whole property')) return true;
						if (selectedPropertyType === 'Granny Flat' && listing.rooms?.toLowerCase().includes('granny flat')) return true;
						return false;
				}
				return type && type.trim() === selectedPropertyType;
			});
		}
        
        // 2. Apply Sorting
        const sortBy = sortResultsSelect.value;
        currentProcessedListings.sort((a, b) => {
            const priceA = parsePrice(a.price);
            const priceB = parsePrice(b.price);

            if (priceA === null && priceB === null) return 0;
            if (priceA === null) return 1; // Nulls (unparseable) go to the end
            if (priceB === null) return -1;

            if (sortBy === 'price-asc') {
                return priceA - priceB;
            } else if (sortBy === 'price-desc') {
                return priceB - priceA;
            }
            return 0;
        });

        processedListings = currentProcessedListings; // Update the global processed list
        clientSideCurrentPage = 1; // Reset to first page for new filter/sort
        renderClientSidePage();
        setupClientSidePagination();
    }

    function parsePrice(priceString) {
        if (!priceString || typeof priceString !== 'string') return null;
        
        // Remove "pw", "/w", "per week", etc. and any non-numeric/non-decimal characters except '$'
        let cleaned = priceString.toLowerCase().replace(/pw|per week|\/w/g, '').replace(/[^0-9.-]/g, '');
        
        if (cleaned.includes('-')) { // Handle range like "400-500"
            const parts = cleaned.split('-').map(p => parseFloat(p));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return (parts[0] + parts[1]) / 2; // Average
            }
            return null;
        }
        
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    }


	function renderClientSidePage() {
		resultsContainer.innerHTML = '';
		if (processedListings.length === 0) {
			resultsContainer.innerHTML = '<p>No listings match your criteria after filtering.</p>';
			return;
		}

		const startIndex = (clientSideCurrentPage - 1) * CLIENT_SIDE_ITEMS_PER_PAGE;
		const endIndex = startIndex + CLIENT_SIDE_ITEMS_PER_PAGE;
		const pageListings = processedListings.slice(startIndex, endIndex);

		pageListings.forEach(listing => {
			const card = document.createElement('div');
			card.classList.add('listing-card');
			let imagesHtml = '<div class="listing-images">';
			let listingUrl = '#';
			let titleAddress = 'N/A';
			let price = 'N/A';
			let baseDescriptionFromApi = ''; // Original description from API if any
			let scrapedHtmlDescription = listing.scraped_description || ''; // Scraped one

			// --- Features HTML ---
			let featuresHtml = '<ul class="listing-features">'; // Start features list

			if (listing.original_api_source === 'domain') {
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.url ? `https://www.domain.com.au${listing.url}` : '#';
				price = listing.price || 'Price on application';
				if (listing.images && listing.images.length > 0) {
					(listing.images || []).forEach(img => imagesHtml += `<img src="${img.url || img}" alt="Property image">`);
				}
				baseDescriptionFromApi = listing.inspection?.openTime ? `Inspection: ${listing.inspection.openTime} - ${listing.inspection.closeTime}` : (listing.headline || '');
				
				// Domain features
				if (listing.features) {
					if (listing.features.beds !== undefined) featuresHtml += `<li>Beds: ${listing.features.beds}</li>`;
					if (listing.features.baths !== undefined) featuresHtml += `<li>Baths: ${listing.features.baths}</li>`;
					if (listing.features.propertyTypeFormatted) featuresHtml += `<li>Type: ${listing.features.propertyTypeFormatted}</li>`;
				}

			} else if (listing.original_api_source === 'rentdc') {
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.url ? `https://www.rent.com.au${listing.url}` : '#';
				price = listing.price || 'Price on application';
				if (listing.imageUrl) { imagesHtml += `<img src="${listing.imageUrl}" alt="Property image">`; }
				baseDescriptionFromApi = listing.description || ''; 

				// RentDC features
				if (listing.features && Array.isArray(listing.features) && listing.features.length > 0) {
					listing.features.forEach(f => featuresHtml += `<li>${f}</li>`);
				}
				if(listing.propType) featuresHtml += `<li>Type: ${listing.propType}</li>`;


			} else if (listing.original_api_source === 'realestate') {
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.prettyUrl ? `https://www.realestate.com.au${listing.prettyUrl}` : '#';
				price = listing.price || 'Price on application';
				if (listing.images && listing.images.length > 0) {
					(listing.images || []).forEach(imgUrl => imagesHtml += `<img src="${imgUrl}" alt="Property image">`);
				}
				baseDescriptionFromApi = listing.description || '';
				if(listing.bond) baseDescriptionFromApi += `<br><strong>Bond:</strong> ${listing.bond}`;
				if(listing.dateAvailable) baseDescriptionFromApi += `<br><strong>Available:</strong> ${new Date(listing.dateAvailable).toLocaleDateString()}`;
				if(listing.nextInspectionTime) baseDescriptionFromApi += `<br><strong>Inspection:</strong> ${new Date(listing.nextInspectionTime.startTime).toLocaleString()} - ${new Date(listing.nextInspectionTime.endTime).toLocaleString()}`;
				
				// Realestate.com.au features
				if (listing.propertyFeatures && Array.isArray(listing.propertyFeatures) && listing.propertyFeatures.length > 0) {
					listing.propertyFeatures.forEach(f => featuresHtml += `<li>${f}</li>`);
				}
				if(listing.propertyType) featuresHtml += `<li>Type: ${listing.propertyType}</li>`;


			} else if (listing.original_api_source === 'flatmates') {
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.url ? `https://flatmates.com.au${listing.url}` : '#';
				price = listing.price || 'Price on application';
				if (listing.billsIncluded) price += ' (bills incl.)';
				if (listing.images && listing.images.length > 0) {
					(listing.images || []).forEach(imgUrl => imagesHtml += `<img src="${imgUrl}" alt="Property image">`);
				}
				baseDescriptionFromApi = listing.description || '';

				// Flatmates features
				if (listing.bedrooms !== undefined) featuresHtml += `<li>Beds: ${listing.bedrooms}</li>`;
				if (listing.bathrooms !== undefined) featuresHtml += `<li>Baths: ${listing.bathrooms}</li>`;
				if (listing.occupants !== undefined) featuresHtml += `<li>Occupants: ${listing.occupants}</li>`;
				if (listing.rooms) featuresHtml += `<li>Rooms: ${listing.rooms}</li>`;
			}
			
			imagesHtml += '</div>';
			featuresHtml += '</ul>'; // End features list

			// Use scraped HTML description if available, otherwise API's (which might also contain HTML)
			const displayDescriptionHtml = scrapedHtmlDescription || baseDescriptionFromApi;
			const descriptionLengthLimit = 300; // You can adjust this
			let finalDescriptionHtml = displayDescriptionHtml;

			// Simple truncation for HTML (could be more sophisticated to avoid breaking tags badly)
			/*
			if (displayDescriptionHtml.length > descriptionLengthLimit) {
				 // Find a space to break nicely, or just cut
				let breakPoint = displayDescriptionHtml.lastIndexOf(' ', descriptionLengthLimit);
				if (breakPoint === -1 || breakPoint < descriptionLengthLimit / 2) { // if no space or too early
					breakPoint = descriptionLengthLimit;
				}
				finalDescriptionHtml = displayDescriptionHtml.substring(0, breakPoint) + '...';
			}
			*/


			card.innerHTML = `
				<h3><a href="${listingUrl}" target="_blank" rel="noopener noreferrer">${titleAddress}</a></h3>
				<p><strong>Price:</strong> ${price}</p>
				${imagesHtml}
				${featuresHtml} 
				${finalDescriptionHtml ? `<div class="description-html-content">${finalDescriptionHtml}</div>` : '<p>No description available.</p>'}
			`;
			resultsContainer.appendChild(card);
		});
	}


    function setupClientSidePagination() {
        const totalClientPages = Math.ceil(processedListings.length / CLIENT_SIDE_ITEMS_PER_PAGE);
        if (totalClientPages > 1) {
            paginationControls.style.display = 'block';
            pageInfoSpan.textContent = `Page ${clientSideCurrentPage} of ${totalClientPages} (Total results: ${processedListings.length})`;
            prevPageButton.disabled = clientSideCurrentPage <= 1;
            nextPageButton.disabled = clientSideCurrentPage >= totalClientPages;
        } else if (processedListings.length > 0) {
             paginationControls.style.display = 'block';
             pageInfoSpan.textContent = `Page 1 of 1 (Total results: ${processedListings.length})`;
             prevPageButton.disabled = true;
             nextPageButton.disabled = true;
        }
        else {
            paginationControls.style.display = 'none';
        }
    }

    prevPageButton.addEventListener('click', () => {
        if (clientSideCurrentPage > 1) {
            clientSideCurrentPage--;
            renderClientSidePage();
            setupClientSidePagination(); // Update button states and page info
        }
    });

    nextPageButton.addEventListener('click', () => {
        const totalClientPages = Math.ceil(processedListings.length / CLIENT_SIDE_ITEMS_PER_PAGE);
        if (clientSideCurrentPage < totalClientPages) {
            clientSideCurrentPage++;
            renderClientSidePage();
            setupClientSidePagination(); // Update button states and page info
        }
    });
    
    function showError(message) {
        loadingMessageDiv.style.display = 'none';
        resultsContainer.innerHTML = '';
        paginationControls.style.display = 'none';
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
});