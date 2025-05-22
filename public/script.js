document.addEventListener('DOMContentLoaded', () => {
    const PROXY_BASE_URL = 'https://openai-ausrental-search-d3ys.onrender.com/';

    const tabs = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error-message');
    const resultsContainer = document.getElementById('results-container');
    const paginationControls = document.getElementById('pagination-controls');
    const prevPageButton = document.getElementById('prev-page');
    const nextPageButton = document.getElementById('next-page');
    const pageInfoSpan = document.getElementById('page-info');

    let currentApiSource = 'domain'; // Default active tab
    let currentPage = 1;
    let totalPages = 1;
    let currentFormData = null; // To store form data for pagination

    // --- Tab Switching ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
            
            currentApiSource = tab.dataset.tab;
            resultsContainer.innerHTML = ''; // Clear results on tab switch
            paginationControls.style.display = 'none'; // Hide pagination
            errorDiv.style.display = 'none';
        });
    });

    // --- Form Submission ---
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            currentPage = 1; // Reset to page 1 for new search
            const formHiddenPageInput = form.querySelector('input[name="page"]');
            if (formHiddenPageInput) {
                formHiddenPageInput.value = currentPage;
            }
            currentFormData = new FormData(form);
            fetchData(currentApiSource, currentFormData);
        });
    });

    // --- Fetch Data Function ---
    async function fetchData(apiSource, formData) {
        loadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        resultsContainer.innerHTML = '';
        paginationControls.style.display = 'none';

        // Update page in formData for pagination calls
        if (formData.has('page')) {
            formData.set('page', currentPage);
        } else {
            formData.append('page', currentPage);
        }

        let url;
        let params = new URLSearchParams();

        // Filter out empty values and build query string
        for (const [key, value] of formData.entries()) {
            if (value !== null && value !== '' && value !== undefined) {
                if (value instanceof File && value.name === "" && value.size === 0) continue; // Skip empty file inputs if any
                 // For checkboxes that are not checked, FormData doesn't include them.
                 // For boolean parameters where false is 'false' string or 0, need specific handling if desired.
                 // Here, we assume presence means true for checkboxes, and text inputs provide values.
                params.append(key, value);
            }
        }
        
        const queryString = params.toString();

        switch (apiSource) {
            case 'domain':
                url = `${PROXY_BASE_URL}/domain/?${queryString}`;
                break;
            case 'rentdc':
                // rent.com.au has suburbs in path
                const suburbs = formData.get('suburbs');
                if (!suburbs) {
                    showError("Suburbs are required for Rent.com.au");
                    return;
                }
                // Remove suburbs from query params as it's in the path
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
                showError('Invalid API source.');
                return;
        }
        
        console.log("Requesting URL:", url);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP error! status: ${response.status}` }));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log("Received data:", data);
            displayResults(data, apiSource);
            setupPagination(data, apiSource);
        } catch (error) {
            console.error('Fetch error:', error);
            showError(`Failed to fetch data: ${error.message}`);
        } finally {
            loadingDiv.style.display = 'none';
        }
    }

    // --- Display Results ---
    function displayResults(data, apiSource) {
        resultsContainer.innerHTML = ''; // Clear previous results

        let listings = [];
        if (!data) {
            resultsContainer.innerHTML = '<p>No results found or error in response.</p>';
            return;
        }

        switch (apiSource) {
            case 'domain':
                if (data.listings && typeof data.listings === 'object') {
                    listings = Object.values(data.listings).map(l => l.listingModel);
                }
                break;
            case 'rentdc':
                listings = data.listings || [];
                break;
            case 'realestate':
                listings = data.listings || [];
                break;
            case 'flatmates':
                listings = data.listings || [];
                break;
        }

        if (listings.length === 0) {
            resultsContainer.innerHTML = '<p>No listings found for your criteria.</p>';
            return;
        }

        listings.forEach(listing => {
            const card = document.createElement('div');
            card.classList.add('listing-card');
            let imagesHtml = '<div class="listing-images">';
            let listingUrl = '#';
            let titleAddress = 'N/A';
            let price = 'N/A';
            let description = '';
            let featuresHtml = '<ul class="listing-features">';

            // Adapt to different API response structures
            if (apiSource === 'domain') {
                titleAddress = listing.address || 'Address not available';
                listingUrl = listing.url ? `https://www.domain.com.au${listing.url}` : '#';
                price = listing.price || 'Price on application';
                if (listing.images && listing.images.length > 0) {
                    listing.images.forEach(img => imagesHtml += `<img src="${img.url || img}" alt="Property image">`);
                }
                if (listing.features) {
                    featuresHtml += `<li>Beds: ${listing.features.beds || 'N/A'}</li>`;
                    featuresHtml += `<li>Baths: ${listing.features.baths || 'N/A'}</li>`;
                    if(listing.features.propertyTypeFormatted) featuresHtml += `<li>Type: ${listing.features.propertyTypeFormatted}</li>`;
                }
                description = listing.inspection?.openTime ? `Inspection: ${listing.inspection.openTime} - ${listing.inspection.closeTime}` : (listing.headline || '');

            } else if (apiSource === 'rentdc') {
                titleAddress = listing.address || 'Address not available';
                listingUrl = listing.url ? `https://www.rent.com.au${listing.url}` : '#'; // Assuming root needed
                price = listing.price || 'Price on application';
                if (listing.imageUrl) { // rent.com.au seems to provide one main imageUrl
                    imagesHtml += `<img src="${listing.imageUrl}" alt="Property image">`;
                }
                if (listing.features && listing.features.length > 0) {
                    listing.features.forEach(f => featuresHtml += `<li>${f}</li>`);
                }
                if(listing.propType) featuresHtml += `<li>Type: ${listing.propType}</li>`;
                description = listing.description || '';

            } else if (apiSource === 'realestate') {
                titleAddress = listing.address || 'Address not available';
                listingUrl = listing.prettyUrl ? `https://www.realestate.com.au${listing.prettyUrl}` : '#';
                price = listing.price || 'Price on application';
                 if (listing.images && listing.images.length > 0) {
                    listing.images.forEach(imgUrl => imagesHtml += `<img src="${imgUrl}" alt="Property image">`);
                }
                if (listing.propertyFeatures && listing.propertyFeatures.length > 0) {
                    listing.propertyFeatures.forEach(f => featuresHtml += `<li>${f}</li>`);
                }
                if(listing.propertyType) featuresHtml += `<li>Type: ${listing.propertyType}</li>`;
                description = listing.description || '';
                if(listing.bond) description += `<br><strong>Bond:</strong> ${listing.bond}`;
                if(listing.dateAvailable) description += `<br><strong>Available:</strong> ${new Date(listing.dateAvailable).toLocaleDateString()}`;
                if(listing.nextInspectionTime) description += `<br><strong>Inspection:</strong> ${new Date(listing.nextInspectionTime.startTime).toLocaleString()} - ${new Date(listing.nextInspectionTime.endTime).toLocaleString()}`;


            } else if (apiSource === 'flatmates') {
                titleAddress = listing.address || 'Address not available';
                listingUrl = listing.url ? `https://flatmates.com.au${listing.url}` : '#';
                price = listing.price || 'Price on application';
                if (listing.billsIncluded) price += ' (bills incl.)';
                if (listing.images && listing.images.length > 0) {
                    listing.images.forEach(imgUrl => imagesHtml += `<img src="${imgUrl}" alt="Property image">`);
                }
                if (listing.bedrooms) featuresHtml += `<li>Beds: ${listing.bedrooms}</li>`;
                if (listing.bathrooms) featuresHtml += `<li>Baths: ${listing.bathrooms}</li>`;
                if (listing.occupants) featuresHtml += `<li>Occupants: ${listing.occupants}</li>`;
                if (listing.rooms) featuresHtml += `<li>Rooms: ${listing.rooms}</li>`;
                description = listing.description || '';
            }
            
            imagesHtml += '</div>';
            featuresHtml += '</ul>';

            card.innerHTML = `
                <h3><a href="${listingUrl}" target="_blank">${titleAddress}</a></h3>
                <p><strong>Price:</strong> ${price}</p>
                ${imagesHtml}
                ${featuresHtml}
                ${description ? `<p class="description">${description.substring(0,200)}${description.length > 200 ? '...' : ''}</p>` : ''}
            `;
            resultsContainer.appendChild(card);
        });
    }

    // --- Setup Pagination ---
    function setupPagination(data, apiSource) {
        let listingsPerPage = 20; // Default or from API
        let totalListings = 0;

        if (!data) {
            paginationControls.style.display = 'none';
            return;
        }

        switch (apiSource) {
            case 'domain':
                totalPages = data.totalPages || 1;
                currentPage = data.page || 1;
                totalListings = data.totalListings || 0;
                listingsPerPage = data.listingsPerPage || (Object.keys(data.listings || {}).length);
                break;
            case 'rentdc':
                totalListings = data.totalListings || 0;
                // rent.com.au seems to have 20 listings per page implicitly
                listingsPerPage = 20; 
                totalPages = Math.ceil(totalListings / listingsPerPage);
                currentPage = data.currentPageNum || 1;
                break;
            case 'realestate':
                totalListings = data.totalListings || 0;
                listingsPerPage = data.pageSize || 20;
                totalPages = Math.ceil(totalListings / listingsPerPage);
                currentPage = data.currentPage || 1;
                break;
            case 'flatmates':
                // Flatmates gives nextPage, doesn't directly give totalPages.
                // We might need to infer or just enable "Next" if nextPage is present.
                // For simplicity, if nextPage is null/undefined, assume it's the last.
                // This is a simplification; a real app might need more logic.
                currentPage = parseInt(currentFormData.get('page') || '1'); // Get current page from form data
                if (data.nextPage) {
                    totalPages = currentPage + 1; // At least one more page
                } else {
                    totalPages = currentPage; // This is the last page
                }
                // If we want to show total pages, we need total listings from somewhere
                // or make an initial request that provides it, or just show "Page X"
                totalListings = listingsPerPage * currentPage + (data.nextPage ? listingsPerPage : 0); // Approximation
                break;
        }
        
        if (totalListings > 0 && totalPages > 1) {
            paginationControls.style.display = 'block';
            pageInfoSpan.textContent = `Page ${currentPage} of ${totalPages} (Total: ${totalListings})`;
            prevPageButton.disabled = currentPage <= 1;
            nextPageButton.disabled = currentPage >= totalPages;
        } else if (totalListings > 0 && totalPages === 1) {
             paginationControls.style.display = 'block';
             pageInfoSpan.textContent = `Page 1 of 1 (Total: ${totalListings})`;
             prevPageButton.disabled = true;
             nextPageButton.disabled = true;
        }
         else {
            paginationControls.style.display = 'none';
        }
    }

    // --- Pagination Button Clicks ---
    prevPageButton.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            fetchData(currentApiSource, currentFormData);
        }
    });

    nextPageButton.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            fetchData(currentApiSource, currentFormData);
        }
    });
    
    function showError(message) {
        loadingDiv.style.display = 'none';
        resultsContainer.innerHTML = '';
        paginationControls.style.display = 'none';
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    // Activate the default tab's form for initial view (optional)
    // document.querySelector(`#${currentApiSource}-form button[type="submit"]`).click(); 
    // Or simply leave it blank until user interacts.
});