document.addEventListener('DOMContentLoaded', () => {
    const PROXY_BASE_URL = 'https://openai-ausrental-search-d3ys.onrender.com';

    // --- UI Elements ---
	const filterPropertyTypeExcludeSelect = document.getElementById('filter-property-type-exclude');
    const tabs = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const loadingMessageDiv = document.getElementById('loading-message');
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
    let currentApiSource = 'domain'; // Default active tab
    let allFetchedListings = [];
    let processedListings = [];
	let lightboxOverlay = null;
	let lightboxImageElement = null;
	let lightboxPrevButton = null;
	let lightboxNextButton = null;
	let currentLightboxImages = [];
	let currentLightboxImageIndex = 0;
    
    let clientSideCurrentPage = 1;
    const CLIENT_SIDE_ITEMS_PER_PAGE = 10;

    const DESCRIPTION_FETCH_DELAY_MS = 100;
    const DESCRIPTION_FETCH_BATCH_SIZE = 10;
    const BULK_DELAY_MS = 1000;
    const BULK_DELAY_BATCH_SIZE = 100;

    let initialFormData = null;

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
            const targetTabContent = document.getElementById(tab.dataset.tab);
            if (targetTabContent) {
                targetTabContent.classList.add('active');
            }
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
		filterPropertyTypeExcludeSelect.innerHTML = ''; // Clear existing options
		// Reset selection for multi-select if needed, though clearing options does this
		Array.from(filterPropertyTypeExcludeSelect.options).forEach(option => option.selected = false);
    }

    // --- Form Submission ---
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            clearResultsAndState(); // Clear previous results and filters
            initialFormData = new FormData(form); // Store form data from the submitted form
            fetchAllDataProcess();
        });
    });

    // --- Event Listeners for Filters and Sort ---
	filterPropertyTypeExcludeSelect.addEventListener('change', processAndDisplayListings);
    filterAddressInput.addEventListener('input', debounce(processAndDisplayListings, 500));
    filterDescriptionInput.addEventListener('input', debounce(processAndDisplayListings, 500));
    sortResultsSelect.addEventListener('change', processAndDisplayListings);

	function createLightbox() {
		if (document.getElementById('image-lightbox-overlay')) return;

		lightboxOverlay = document.createElement('div');
		lightboxOverlay.id = 'image-lightbox-overlay';
		lightboxOverlay.classList.add('lightbox-overlay');
		lightboxOverlay.style.display = 'none';

		const content = document.createElement('div');
		content.classList.add('lightbox-content');

		lightboxImageElement = document.createElement('img');
		lightboxImageElement.classList.add('lightbox-image');
		lightboxImageElement.alt = 'Full screen property image';

		const closeButton = document.createElement('button');
		closeButton.classList.add('lightbox-close');
		closeButton.innerHTML = '×';
		closeButton.title = 'Close (Esc)';
		closeButton.onclick = closeLightbox;

		lightboxPrevButton = document.createElement('button');
		lightboxPrevButton.classList.add('lightbox-nav', 'lightbox-prev');
		lightboxPrevButton.innerHTML = '❮';
		lightboxPrevButton.title = 'Previous (Left Arrow)';
		lightboxPrevButton.onclick = () => showLightboxImage(currentLightboxImageIndex - 1);

		lightboxNextButton = document.createElement('button');
		lightboxNextButton.classList.add('lightbox-nav', 'lightbox-next');
		lightboxNextButton.innerHTML = '❯';
		lightboxNextButton.title = 'Next (Right Arrow)';
		lightboxNextButton.onclick = () => showLightboxImage(currentLightboxImageIndex + 1);

		content.appendChild(lightboxImageElement);
		content.appendChild(closeButton);
		lightboxOverlay.appendChild(content);
		lightboxOverlay.appendChild(lightboxPrevButton);
		lightboxOverlay.appendChild(lightboxNextButton);

		document.body.appendChild(lightboxOverlay);

		lightboxOverlay.addEventListener('click', function(event) {
			if (event.target === lightboxOverlay) {
				closeLightbox();
			}
		});
	}

	function openLightbox(imagesArray, startIndex) {
		if (!lightboxOverlay) createLightbox();

		currentLightboxImages = imagesArray.map(img => (typeof img === 'object' && img.templatedUrl) ? img.templatedUrl.replace('{size}', '1280x960') : img.replace('{size}', '1280x960'));
		currentLightboxImageIndex = startIndex;
		
		showLightboxImage(currentLightboxImageIndex);
		lightboxOverlay.style.display = 'flex';
		document.addEventListener('keydown', handleLightboxKeyDown);
		document.body.style.overflow = 'hidden';
	}

	function showLightboxImage(index) {
		if (!currentLightboxImages || currentLightboxImages.length === 0) return;

		currentLightboxImageIndex = (index + currentLightboxImages.length) % currentLightboxImages.length;
		lightboxImageElement.src = currentLightboxImages[currentLightboxImageIndex];

		if (currentLightboxImages.length <= 1) {
			lightboxPrevButton.classList.add('hidden');
			lightboxNextButton.classList.add('hidden');
		} else {
			lightboxPrevButton.classList.remove('hidden');
			lightboxNextButton.classList.remove('hidden');
		}
	}

	function closeLightbox() {
		if (lightboxOverlay) {
			lightboxOverlay.style.display = 'none';
		}
		document.removeEventListener('keydown', handleLightboxKeyDown);
		document.body.style.overflow = '';
	}

	function handleLightboxKeyDown(event) {
		if (event.key === 'Escape') {
			closeLightbox();
		} else if (event.key === 'ArrowLeft') {
			showLightboxImage(currentLightboxImageIndex - 1);
		} else if (event.key === 'ArrowRight') {
			showLightboxImage(currentLightboxImageIndex + 1);
		}
	}

	function populatePropertyTypeExcludeFilter(apiSource, listings) {
		filterPropertyTypeExcludeSelect.innerHTML = ''; // Clear previous options
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
				case 'realestate': // Old API
					type = listing.propertyType;
					break;
                case 'realestategraph': // New GraphQL API
                    type = listing.propertyType;
                    break;
				case 'flatmates':
					if (listing.rooms?.toLowerCase().includes('share house')) type = 'Share House';
					else if (listing.rooms?.toLowerCase().includes('studio')) type = 'Studio';
					else if (listing.rooms?.toLowerCase().includes('whole property')) type = 'Whole Property';
					else if (listing.rooms?.toLowerCase().includes('granny flat')) type = 'Granny Flat';
                    else if (listing.rooms?.toLowerCase().includes('homestay')) type = 'Homestay';
                    else if (listing.rooms?.toLowerCase().includes('student accommodation')) type = 'Student Accommodation';
					break;
			}
			if (type && typeof type === 'string' && type.trim() !== '') {
				availableTypes.add(type.trim());
			}
		});

		if (apiSource === 'flatmates' && availableTypes.size === 0) {
			['Share House', 'Studio', 'Whole Property', 'Granny Flat', 'Homestay', 'Student Accommodation'].forEach(t => availableTypes.add(t));
		}


		Array.from(availableTypes).sort().forEach(type => {
			const option = document.createElement('option');
			option.value = type;
			option.textContent = type;
			filterPropertyTypeExcludeSelect.appendChild(option);
		});
        // Default exclusion for "Acreage / Semi-Rural" can be set here if needed
        // Example:
        // const acreageOption = Array.from(filterPropertyTypeExcludeSelect.options).find(opt => opt.value === "Acreage / Semi-Rural");
        // if (acreageOption) acreageOption.selected = true;

		// Default exclude specific types if they exist
		const defaultExclusions = ["Acreage / Semi-Rural", "New House & Land", "Retirement Living"];
		defaultExclusions.forEach(exclusion => {
			const optionToExclude = Array.from(filterPropertyTypeExcludeSelect.options).find(opt => opt.value === exclusion);
			if (optionToExclude) {
				optionToExclude.selected = true;
			}
		});

	}

    async function fetchAllDataProcess() {
        if (!initialFormData && document.getElementById(`${currentApiSource}-form`)) {
            initialFormData = new FormData(document.getElementById(`${currentApiSource}-form`));
        } else if (!initialFormData) {
             showError("Form data is not available. Please submit a search.");
             return;
        }

        loadingMessageDiv.textContent = 'Fetching initial listings...';
        loadingMessageDiv.style.display = 'block';
        errorDiv.style.display = 'none';

        let listingsFromApi = [];
        let currentPageForApi = 1;
        let hasMorePages = true;
        let totalApiPages = 1; // Initialize for APIs that provide total pages

        try {
            while (hasMorePages) {
                loadingMessageDiv.textContent = `Fetching listings (API Page ${currentPageForApi}${totalApiPages > 1 ? ` of ${totalApiPages}`: ''})...`;
                
                let formDataForPage;
                if (initialFormData) {
                    formDataForPage = new FormData();
                    for (const [key, value] of initialFormData.entries()) {
                        formDataForPage.append(key, value);
                    }
                } else { 
                    const currentFormElement = document.getElementById(`${currentApiSource}-form`);
                    if (currentFormElement) {
                        formDataForPage = new FormData(currentFormElement);
                    } else {
                        throw new Error("Could not retrieve form data for API request.");
                    }
                }
                
                if (formDataForPage.has('page')) {
                    formDataForPage.set('page', currentPageForApi);
                } else {
                    formDataForPage.append('page', currentPageForApi);
                }
                
                const apiResponse = await makeApiRequest(currentApiSource, formDataForPage);

                if (apiResponse.errors) { // Handle GraphQL errors
                    throw new Error(`API Error: ${apiResponse.errors.map(e => e.message).join(', ')}`);
                }

                let newPageListings = [];
                switch (currentApiSource) {
                    case 'domain':
                        newPageListings = apiResponse.listings ? Object.values(apiResponse.listings).map(l => ({ ...l.listingModel, original_api_source: 'domain' })) : [];
                        totalApiPages = apiResponse.totalPages || 1;
                        hasMorePages = currentPageForApi < totalApiPages;
                        if (currentPageForApi === 1 && newPageListings.length === 0 && (apiResponse.totalListings === 0 || Object.keys(apiResponse.listings || {}).length === 0)) {
                            hasMorePages = false;
                        }
                        break;
                    case 'rentdc':
                        newPageListings = (apiResponse.listings || []).map(l => ({ ...l, original_api_source: 'rentdc' }));
                        totalApiPages = Math.ceil((apiResponse.totalListings || 0) / 20); // rent.com.au typical page size
                        hasMorePages = currentPageForApi < totalApiPages;
                        if (apiResponse.nextPageNum && apiResponse.nextPageNum <= currentPageForApi) hasMorePages = false;
                        if (currentPageForApi === 1 && newPageListings.length === 0 && apiResponse.totalListings === 0) {
                            hasMorePages = false;
                        }
                        break;
                    case 'realestate': // Old API
                        newPageListings = (apiResponse.listings || []).map(l => ({ ...l, original_api_source: 'realestate' }));
                        const pageSizeReaOld = parseInt(formDataForPage.get('pageSize') || '20');
                        totalApiPages = Math.ceil((apiResponse.totalListings || 0) / pageSizeReaOld);
                        hasMorePages = currentPageForApi < totalApiPages;
                         if (currentPageForApi === 1 && newPageListings.length === 0 && apiResponse.totalListings === 0) {
                            hasMorePages = false;
                        }
                        break;
                    case 'realestategraph': // New GraphQL API
                        newPageListings = (apiResponse.listings || []).map(l => ({ ...l, original_api_source: 'realestategraph' }));
                        totalApiPages = apiResponse.totalPages || 1;
                        hasMorePages = currentPageForApi < totalApiPages;
                        if (currentPageForApi === 1 && newPageListings.length === 0 && apiResponse.totalListings === 0) {
                            hasMorePages = false;
                        }
                        break;
                    case 'flatmates':
                        newPageListings = (apiResponse.listings || []).map(l => ({ ...l, original_api_source: 'flatmates' }));
                        hasMorePages = !!apiResponse.nextPage; // Flatmates uses a direct 'nextPage' indicator
                        totalApiPages = hasMorePages ? currentPageForApi + 1 : currentPageForApi; // Approximation
                        if (currentPageForApi === 1 && newPageListings.length === 0 && !apiResponse.nextPage) {
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
            }
            
            allFetchedListings = listingsFromApi;

            if (allFetchedListings.length === 0) {
                loadingMessageDiv.textContent = 'No listings found from the API.';
                processAndDisplayListings();
                return;
            }

            if (currentApiSource === 'domain' || currentApiSource === 'rentdc') {
                await fetchAndScrapeDescriptions(allFetchedListings, currentApiSource);
            }

			populatePropertyTypeExcludeFilter(currentApiSource, allFetchedListings);
            processAndDisplayListings();

        } catch (error) {
            console.error('Error in fetchAllDataProcess:', error);
            showError(`Failed during data fetching: ${error.message}`);
        } finally {
            if (allFetchedListings.length > 0 || errorDiv.style.display === 'block') {
                loadingMessageDiv.style.display = 'none';
            }
        }
    }
    
    async function makeApiRequest(apiSource, formData) {
        let url;
        const params = new URLSearchParams();
        for (const [key, value] of formData.entries()) {
            if (value !== null && value !== '' && value !== undefined) {
                 // For checkboxes, FormData includes them if checked with their value.
                // If not checked, they are not included.
                // We need to ensure boolean 'true'/'false' for some proxy params if they are present.
                if (typeof value === 'boolean') {
                    params.append(key, value.toString());
                } else if (formData.get(key) === "" && (key === "surroundingSuburbs" || key === "furnished" || key === "petsAllowed")) {
                    // If a checkbox is present but empty (can happen if manually added to params), treat as false
                    params.append(key, "false");
                }
                else {
                    params.append(key, value);
                }
            }
        }

        // Explicitly add checkbox values if they are not in formData (meaning they were unchecked)
        // This is mainly for the GraphQL endpoint which might expect these boolean flags.
        if (apiSource === 'realestategraph') {
            if (!formData.has('surroundingSuburbs')) params.set('surroundingSuburbs', 'false');
            if (!formData.has('furnished')) params.set('furnished', 'false');
            if (!formData.has('petsAllowed')) params.set('petsAllowed', 'false');
        }
         if (apiSource === 'realestate') { // Old API
            if (!formData.has('surroundingSuburbs')) params.set('surroundingSuburbs', 'false');
            if (!formData.has('furnished')) params.set('furnished', 'false');
            if (!formData.has('petsAllowed')) params.set('petsAllowed', 'false');
            if (!formData.has('swimmingPool')) params.set('swimmingPool', 'false');
            if (!formData.has('garage')) params.set('garage', 'false');
            if (!formData.has('balcony')) params.set('balcony', 'false');
            if (!formData.has('outdoorArea')) params.set('outdoorArea', 'false');
            if (!formData.has('ensuite')) params.set('ensuite', 'false');
            if (!formData.has('dishwasher')) params.set('dishwasher', 'false');
            if (!formData.has('study')) params.set('study', 'false');
            if (!formData.has('builtInRobes')) params.set('builtInRobes', 'false');
            if (!formData.has('airConditioning')) params.set('airConditioning', 'false');
            if (!formData.has('heating')) params.set('heating', 'false');
        }
        if (apiSource === 'flatmates') {
            if (!formData.has('billsIncluded')) params.set('billsIncluded', 'false');
            if (!formData.has('pets')) params.set('pets', 'false');
            if (!formData.has('smokers')) params.set('smokers', 'false');
            if (!formData.has('shareHouses')) params.set('shareHouses', 'false');
            if (!formData.has('wholeProperties')) params.set('wholeProperties', 'false');
            if (!formData.has('studios')) params.set('studios', 'false');
            if (!formData.has('grannyFlats')) params.set('grannyFlats', 'false');
            // 'couples' is usually a value like "couples", not true/false, handle if needed
        }


        const queryString = params.toString();

        switch (apiSource) {
            case 'domain':
                url = `${PROXY_BASE_URL}/domain/?${queryString}`;
                break;
            case 'rentdc':
                const suburbs = formData.get('suburbs'); // This specific param for path
                if (!suburbs) throw new Error("Suburbs are required for Rent.com.au");
                const rentDcPathParams = new URLSearchParams(params); // Create new for manipulation
                rentDcPathParams.delete('suburbs'); // Remove from query string
                url = `${PROXY_BASE_URL}/rentdc/${encodeURIComponent(suburbs)}?${rentDcPathParams.toString()}`;
                break;
            case 'realestate': // Old API
                url = `${PROXY_BASE_URL}/realestate/?${queryString}`;
                break;
            case 'realestategraph': // New GraphQL API
                url = `${PROXY_BASE_URL}/realestategraph/?${queryString}`;
                break;
            case 'flatmates':
                url = `${PROXY_BASE_URL}/flatmates/?${queryString}`;
                break;
            default:
                throw new Error('Invalid API source.');
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { message: `HTTP error! status: ${response.status}. Response: ${errorText}` };
            }
            throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async function fetchAndScrapeDescriptions(listings, apiSource) {
        loadingMessageDiv.textContent = 'Fetching detailed descriptions... (0%)';
        let fetchedCount = 0;
        const totalToFetch = listings.filter(l => l.url || l.prettyUrl).length; // Adjusted for REA old

        for (let i = 0; i < listings.length; i++) {
            const listing = listings[i];
            let pageUrl = '';

            if (apiSource === 'domain' && listing.url) {
                pageUrl = `https://www.domain.com.au${listing.url}`;
            } else if (apiSource === 'rentdc' && listing.url) {
                pageUrl = `https://www.rent.com.au${listing.url}`;
            }
            // No scraping for realestate or realestategraph as descriptions are in API
            // No scraping for flatmates as descriptions are in API

            if (pageUrl) {
                try {
                    const proxyScrapeUrl = `${PROXY_BASE_URL}/scrape-html?url=${encodeURIComponent(pageUrl)}`;
                    const response = await fetch(proxyScrapeUrl);
                    if (!response.ok) {
                        console.warn(`Failed to scrape ${pageUrl}: ${response.status}`);
                        listing.scraped_description = 'Error fetching description.';
                        fetchedCount++;
                        continue;
                    }
                    const htmlText = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlText, 'text/html');
                    
                    let descHtmlContent = '';
                    if (apiSource === 'domain') {
                        const expanderContent = doc.querySelector('div[data-testid="listing-details__description"] .noscript-expander-content');
                        if (expanderContent) {
                            descHtmlContent = expanderContent.innerHTML;
                        } else {
                            const mainDescElement = doc.querySelector('div[data-testid="listing-details__description"]');
                            if (mainDescElement) {
                                const readMoreButtonContainer = mainDescElement.querySelector('.css-ldqj9h');
                                if (readMoreButtonContainer) readMoreButtonContainer.remove();
                                const mainTitle = mainDescElement.querySelector('h2.css-8shhfl');
                                if (mainTitle) mainTitle.remove();
                                descHtmlContent = mainDescElement.innerHTML;
                            } else {
                                descHtmlContent = 'Description element not found on page.';
                            }
                        }
                    } else if (apiSource === 'rentdc') {
                        const descElement = doc.querySelector('p.property-description-content');
                        descHtmlContent = descElement ? descElement.outerHTML : 'Description element not found on page.';
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
                    fetchedCount++;
                }
            } else {
                listing.scraped_description = listing.scraped_description || '';
            }
        }
    }


    function processAndDisplayListings() {
        if (allFetchedListings.length === 0 && initialFormData) {
            // Do nothing, wait for fetch to complete or show no results from fetch
        } else if (allFetchedListings.length === 0 && !initialFormData) {
            resultsContainer.innerHTML = "<p>Please perform a search first.</p>";
            paginationControls.style.display = 'none';
            return;
        }

        let currentProcessedListings = [...allFetchedListings];
        const addressFilterTerms = filterAddressInput.value.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
        const descriptionFilterTerms = filterDescriptionInput.value.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
		const selectedTypesToExclude = Array.from(filterPropertyTypeExcludeSelect.selectedOptions).map(option => option.value);

        if (addressFilterTerms.length > 0) {
            currentProcessedListings = currentProcessedListings.filter(listing => {
                let addressString = '';
                if (listing.original_api_source === 'realestategraph' && listing.address) {
                    addressString = `${listing.address.full || ''} ${listing.address.short || ''} ${listing.address.suburb || ''}`.toLowerCase();
                } else {
                    addressString = (listing.address || '').toLowerCase();
                }
                return !addressFilterTerms.some(term => addressString.includes(term));
            });
        }
        

        if (descriptionFilterTerms.length > 0) {
            currentProcessedListings = currentProcessedListings.filter(listing => {
                const description = (listing.description || listing.scraped_description || '').toLowerCase();
                return !descriptionFilterTerms.some(term => description.includes(term));
            });
        }

		if (selectedTypesToExclude.length > 0) {
			currentProcessedListings = currentProcessedListings.filter(listing => {
				let type = '';
				switch (listing.original_api_source) {
					case 'domain': type = listing.features?.propertyTypeFormatted; break;
					case 'rentdc': type = listing.propType; break;
					case 'realestate': type = listing.propertyType; break;
                    case 'realestategraph': type = listing.propertyType; break;
					case 'flatmates':
						if (selectedTypesToExclude.includes('Share House') && listing.rooms?.toLowerCase().includes('share house')) return false;
						if (selectedTypesToExclude.includes('Studio') && listing.rooms?.toLowerCase().includes('studio')) return false;
						if (selectedTypesToExclude.includes('Whole Property') && listing.rooms?.toLowerCase().includes('whole property')) return false;
						if (selectedTypesToExclude.includes('Granny Flat') && listing.rooms?.toLowerCase().includes('granny flat')) return false;
                        if (selectedTypesToExclude.includes('Homestay') && listing.rooms?.toLowerCase().includes('homestay')) return false;
                        if (selectedTypesToExclude.includes('Student Accommodation') && listing.rooms?.toLowerCase().includes('student accommodation')) return false;
						return true; 
				}
				return type && typeof type === 'string' ? !selectedTypesToExclude.includes(type.trim()) : true;
			});
		}
        
        const sortBy = sortResultsSelect.value;
        currentProcessedListings.sort((a, b) => {
            const priceA = parsePrice(a.price);
            const priceB = parsePrice(b.price);

            if (priceA === null && priceB === null) return 0;
            if (priceA === null) return 1;
            if (priceB === null) return -1;

            if (sortBy === 'price-asc') return priceA - priceB;
            if (sortBy === 'price-desc') return priceB - priceA;
            return 0;
        });

        processedListings = currentProcessedListings;
        clientSideCurrentPage = 1;
        renderClientSidePage();
        setupClientSidePagination();
    }

    function parsePrice(priceString) {
        if (!priceString || typeof priceString !== 'string') return null;
        let cleaned = priceString.toLowerCase()
            .replace(/pw|per week|\/w|\bweek\b|\bp.w\b/g, '') // More robust week removal
            .replace(/\bfrom\b/gi, '') // Remove "from"
            .replace(/\s*\$?\s*contact agent.*|\s*\$?\s*application.*|\s*\$?\s*no price.*|\s*\$?\s*call.*|\s*\$?\s*enquire.*/gi, '') // Remove phrases
            .replace(/[^0-9.-]/g, '');
        
        if (cleaned.includes('-')) {
            const parts = cleaned.split('-').map(p => parseFloat(p.trim()));
            if (parts.length >= 1 && !isNaN(parts[0])) { // Take the first number if range or single
                return parts[0];
            }
            return null;
        }
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    }

	function formatDateTimeForDisplay(dateTimeString, timeOnlyIfSameDayAsFirst = false, firstDateTimeString = null) {
		if (!dateTimeString) return '';
		try {
			const date = new Date(dateTimeString);
			if (isNaN(date.getTime())) return dateTimeString;

			const optionsDate = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
			const optionsTime = { hour: 'numeric', minute: '2-digit', hour12: true };

			if (timeOnlyIfSameDayAsFirst && firstDateTimeString) {
				const firstDate = new Date(firstDateTimeString);
				if (!isNaN(firstDate.getTime()) &&
					date.getFullYear() === firstDate.getFullYear() &&
					date.getMonth() === firstDate.getMonth() &&
					date.getDate() === firstDate.getDate()) {
					return date.toLocaleTimeString(undefined, optionsTime);
				}
			}
			return `${date.toLocaleDateString(undefined, optionsDate)}, ${date.toLocaleTimeString(undefined, optionsTime)}`;
		} catch (e) {
			console.error("Error formatting date:", dateTimeString, e);
			return dateTimeString;
		}
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
			let baseDescriptionFromApi = '';
			let scrapedHtmlDescription = listing.scraped_description || '';
			let inspectionTimesHtml = '';
            let featuresHtml = '<ul class="listing-features">';
            let agencyHtml = '';
            let listersHtml = '';
            let availableDateHtml = listing.availableDate ? `<p><strong>Available:</strong> ${listing.availableDate}</p>` : '';
            let bondHtml = listing.bond ? `<p><strong>Bond:</strong> ${listing.bond}</p>` : '';


			if (listing.original_api_source === 'domain') {
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.url ? `https://www.domain.com.au${listing.url}` : '#';
				price = listing.price || 'Price on application';
				if (listing.images && listing.images.length > 0) {
					(listing.images || []).forEach(img => imagesHtml += `<img src="${img.url || img}" alt="Property image">`);
				}
				baseDescriptionFromApi = listing.inspection?.openTime ? `Inspection: ${listing.inspection.openTime} - ${listing.inspection.closeTime}` : (listing.headline || '');
				if (listing.features) {
					if (listing.features.beds !== undefined) featuresHtml += `<li>Beds: ${listing.features.beds}</li>`;
					if (listing.features.baths !== undefined) featuresHtml += `<li>Baths: ${listing.features.baths}</li>`;
                    if (listing.features.parking !== undefined && listing.features.parking?.total > 0) featuresHtml += `<li>Parking: ${listing.features.parking.total}</li>`;
					if (listing.features.propertyTypeFormatted) featuresHtml += `<li>Type: ${listing.features.propertyTypeFormatted}</li>`;
				}
				if (listing.inspection && listing.inspection.openTime) {
					const openTime = formatDateTimeForDisplay(listing.inspection.openTime);
					let inspectionText = `<strong>Inspection:</strong> ${openTime}`;
					if (listing.inspection.closeTime) {
						const closeTime = formatDateTimeForDisplay(listing.inspection.closeTime, true, listing.inspection.openTime);
						inspectionText += ` - ${closeTime}`;
					}
					inspectionTimesHtml = `<p>${inspectionText}</p>`;
				}

			} else if (listing.original_api_source === 'rentdc') {
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.url ? `https://www.rent.com.au${listing.url}` : '#';
				price = listing.price || 'Price on application';
				if (listing.imageUrl) { imagesHtml += `<img src="${listing.imageUrl}" alt="Property image">`; }
				baseDescriptionFromApi = listing.description || ''; 
				if (listing.features && Array.isArray(listing.features) && listing.features.length > 0) {
					listing.features.forEach(f => featuresHtml += `<li>${f}</li>`);
				}
				if(listing.propType) featuresHtml += `<li>Type: ${listing.propType}</li>`;

			} else if (listing.original_api_source === 'realestate') { // Old API
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.prettyUrl ? `https://www.realestate.com.au${listing.prettyUrl}` : '#';
				price = listing.price || 'Price on application';
				if (listing.images && listing.images.length > 0) {
					(listing.images || []).forEach(imgUrl => imagesHtml += `<img src="${imgUrl}" alt="Property image">`);
				}
				baseDescriptionFromApi = listing.description || '';
                bondHtml = listing.bond ? `<p><strong>Bond:</strong> ${listing.bond}</p>` : '';
                availableDateHtml = listing.dateAvailable ? `<p><strong>Available:</strong> ${new Date(listing.dateAvailable).toLocaleDateString()}</p>` : '';

				if (listing.propertyFeatures && Array.isArray(listing.propertyFeatures) && listing.propertyFeatures.length > 0) {
					listing.propertyFeatures.forEach(f => featuresHtml += `<li>${f}</li>`);
				}
				if(listing.propertyType) featuresHtml += `<li>Type: ${listing.propertyType}</li>`;

				if (listing.nextInspectionTime && listing.nextInspectionTime.startTime) {
					const startTime = formatDateTimeForDisplay(listing.nextInspectionTime.startTime);
					let inspectionText = `<strong>Next Inspection:</strong> ${startTime}`;
					if (listing.nextInspectionTime.endTime) {
						const endTime = formatDateTimeForDisplay(listing.nextInspectionTime.endTime, true, listing.nextInspectionTime.startTime);
						inspectionText += ` - ${endTime}`;
					}
					inspectionTimesHtml = `<p>${inspectionText}</p>`;
				}
            } else if (listing.original_api_source === 'realestategraph') { // New GraphQL API
                titleAddress = listing.address?.full || listing.address?.short || 'Address not available';
                listingUrl = listing.url || '#'; // URL is absolute from proxy
                price = listing.price || 'Price on application';
                
                if (listing.images && listing.images.length > 0) {
                    listing.images.forEach(imgUrl => imagesHtml += `<img src="${imgUrl.replace('{size}', '640x480')}" alt="Property image">`);
                } else if (listing.mainImage) {
                    imagesHtml += `<img src="${listing.mainImage.replace('{size}', '640x480')}" alt="Property image">`;
                }

                baseDescriptionFromApi = listing.description || ''; // Description is plain text
                
                if (listing.bedrooms !== undefined) featuresHtml += `<li>Beds: ${listing.bedrooms}</li>`;
                if (listing.bathrooms !== undefined) featuresHtml += `<li>Baths: ${listing.bathrooms}</li>`;
                if (listing.parkingSpaces !== undefined) featuresHtml += `<li>Parking: ${listing.parkingSpaces}</li>`;
                if (listing.studies !== undefined && listing.studies > 0) featuresHtml += `<li>Studies: ${listing.studies}</li>`;
                if (listing.propertyType) featuresHtml += `<li>Type: ${listing.propertyType}</li>`;
                if (listing.productDepth) featuresHtml += `<li>Listing Tier: ${listing.productDepth}</li>`;


                if (listing.agencyName) {
                    agencyHtml = `<div class="agency-info"><strong>Agency:</strong> ${listing.agencyName}`;
                    if (listing.agencyLogo) {
                        agencyHtml += `<img src="${listing.agencyLogo.replace('{size}', '100x40')}" alt="${listing.agencyName} logo" class="agency-logo">`;
                    }
                    agencyHtml += `</div>`;
                }
                if (listing.listers && listing.listers.length > 0) {
                    listersHtml = '<div class="listers-info"><strong>Listers:</strong><ul>';
                    listing.listers.forEach(l => {
                        listersHtml += `<li>${l.name || 'N/A'}${l.phone ? ` (${l.phone})` : ''}</li>`;
                    });
                    listersHtml += '</ul></div>';
                }

                if (listing.inspections && listing.inspections.length > 0) {
                    inspectionTimesHtml = '<strong>Inspections:</strong><ul>';
                    listing.inspections.forEach((insp, index) => {
                        const startTime = formatDateTimeForDisplay(insp.startTime);
                        let inspectionText = startTime;
                        if (insp.endTime) {
                             const endTime = formatDateTimeForDisplay(insp.endTime, true, insp.startTime);
                             inspectionText += ` - ${endTime}`;
                        }
                        inspectionTimesHtml += `<li>${insp.label || inspectionText}</li>`;
                    });
                    inspectionTimesHtml += '</ul>';
                }


			} else if (listing.original_api_source === 'flatmates') {
				titleAddress = listing.address || 'Address not available';
				listingUrl = listing.url ? `https://flatmates.com.au${listing.url}` : '#';
				price = listing.price || 'Price on application';
				if (listing.billsIncluded) price += ' (bills incl.)';
				if (listing.images && listing.images.length > 0) {
					(listing.images || []).forEach(imgUrl => imagesHtml += `<img src="${imgUrl}" alt="Property image">`);
				}
				baseDescriptionFromApi = listing.description || '';
				if (listing.bedrooms !== undefined) featuresHtml += `<li>Beds: ${listing.bedrooms}</li>`;
				if (listing.bathrooms !== undefined) featuresHtml += `<li>Baths: ${listing.bathrooms}</li>`;
				if (listing.occupants !== undefined) featuresHtml += `<li>Occupants: ${listing.occupants}</li>`;
				if (listing.rooms) featuresHtml += `<li>Rooms: ${listing.rooms}</li>`;
			}
			
			imagesHtml += '</div>';
			featuresHtml += '</ul>';

			const displayDescriptionHtml = scrapedHtmlDescription || baseDescriptionFromApi;
            let finalDescriptionHtml = displayDescriptionHtml;

            // For GraphQL, description is plain text. Wrap in <p> if not already HTML.
            if (listing.original_api_source === 'realestategraph' && displayDescriptionHtml && !displayDescriptionHtml.match(/<[^>]+>/)) {
                finalDescriptionHtml = `<p>${displayDescriptionHtml.replace(/\n/g, '<br>')}</p>`;
            }


			card.innerHTML = `
				<h3><a href="${listingUrl}" target="_blank" rel="noopener noreferrer">${titleAddress}</a></h3>
                ${listing.original_api_source === 'realestategraph' && listing.id ? `<p><small>ID: ${listing.id}</small></p>` : ''}
				<p><strong>Price:</strong> ${price}</p>
				<div class="listing-images-container">${imagesHtml}</div>
				${featuresHtml}
                ${agencyHtml}
                ${listersHtml}
                ${availableDateHtml}
                ${bondHtml}
				${inspectionTimesHtml ? `<div class="inspection-times">${inspectionTimesHtml}</div>` : ''}
				${finalDescriptionHtml ? `<div class="description-html-content">${finalDescriptionHtml}</div>` : '<p>No description available.</p>'}
			`;
			resultsContainer.appendChild(card);

            const imageElements = card.querySelectorAll('.listing-images-container img');
            const allImageUrlsForThisListing = [];

            if (listing.images && Array.isArray(listing.images)) {
                listing.images.forEach(imgData => {
                    if (typeof imgData === 'string') { // Flatmates, REA GraphQL (already URL string)
                        allImageUrlsForThisListing.push(imgData);
                    } else if (imgData && (imgData.url)) { // Domain specific structure
                        allImageUrlsForThisListing.push(imgData.url);
                    } else if (imgData && imgData.server && imgData.uri) { // REA Old specific structure
                         allImageUrlsForThisListing.push(imgData.server + imgData.uri);
                    }
                });
            } else if (listing.imageUrl && typeof listing.imageUrl === 'string') { // RentDC
                allImageUrlsForThisListing.push(listing.imageUrl);
            } else if (listing.mainImage && typeof listing.mainImage === 'string') { // REA GraphQL fallback
                allImageUrlsForThisListing.push(listing.mainImage);
            }

            const validImageUrls = allImageUrlsForThisListing.filter(url => url && typeof url === 'string');

            imageElements.forEach((imgElement) => {
                imgElement.style.cursor = 'pointer';
                imgElement.addEventListener('click', (e) => {
                    e.preventDefault();
                    const clickedSrc = imgElement.getAttribute('src');
                    // For templated URLs, we need to find the base part if {size} is present
                    const clickedSrcBase = clickedSrc.includes('{size}') ? clickedSrc.split('{size}')[0] : clickedSrc;

                    let clickedImageIndex = validImageUrls.findIndex(url => {
                        const urlBase = url.includes('{size}') ? url.split('{size}')[0] : url;
                        return urlBase === clickedSrcBase;
                    });

                    if (clickedImageIndex === -1) clickedImageIndex = 0; // Fallback

                    if (validImageUrls.length > 0) {
                        openLightbox(validImageUrls, clickedImageIndex);
                    }
                });
            });
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
            setupClientSidePagination();
        }
    });

    nextPageButton.addEventListener('click', () => {
        const totalClientPages = Math.ceil(processedListings.length / CLIENT_SIDE_ITEMS_PER_PAGE);
        if (clientSideCurrentPage < totalClientPages) {
            clientSideCurrentPage++;
            renderClientSidePage();
            setupClientSidePagination();
        }
    });
    
    function showError(message) {
        loadingMessageDiv.style.display = 'none';
        resultsContainer.innerHTML = '';
        paginationControls.style.display = 'none';
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    // Initialize the first active tab (Domain.com.au)
    // No automatic form submission on load, user needs to click search.
    // If you want to auto-submit for the default tab, you could call:
    // document.getElementById('domain-form').dispatchEvent(new Event('submit'));
    // after DOMContentLoaded. For now, it waits for user interaction.
});