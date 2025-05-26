const express = require('express');
const proxy = require('express-http-proxy');
const cheerio = require('cheerio');
const {URLSearchParams} = require('url');
const cors = require("cors");

function extractUrlParameters(urlString) {
  const parsedUrl = new URLSearchParams(urlString);
  const params = Object.fromEntries(parsedUrl.entries());
  return params;
}

function getfeaturesList(variables) {
  const variableNames = [];
  for (const variable in variables) {
    if (variables[variable]) {
      variableNames.push(variable);
    }
  }
  return variableNames;
}

function constructObject(channel, searchLocation, pageSize, page, propertyType, minimumPrice, maximumPrice, minBedrooms, minBathrooms, minParkingSpaces, surroundingSuburbs, furnished, petsAllowed, terms) {
  const obj = {
    channel: channel,
    localities: [
      {
        searchLocation: searchLocation
      }
    ],
    pageSize: pageSize,
    page: page,
    filters: {
      furnished:furnished,
      propertyTypes: [propertyType],
	  bedroomsRange:{"minimum":minBedrooms},
	  minimumBathroom:{"minimum":minBathrooms},
	  minimumCars:{"minimum":minParkingSpaces},
      priceRange: {
        minimum: minimumPrice,
        maximum: maximumPrice
      },
      "keywords":{
	    terms: terms
      },
      petsAllowed:petsAllowed,
      surroundingSuburbs: surroundingSuburbs,
	  excludeNoDisplayPrice:true,
	  excludeNoSalePrice:true,
      excludeAuctions:true,
      "ex-under-contract":true,
      "ex-deposit-taken":true
    }
  };
  return obj;
}

function extractListingDetails(html) {
  const $ = cheerio.load(html);
  let nextPageNum = null;
  let currentPageNum = 1;
  let totalListings = 0;

  const totalListStrong = $('div.listings h2 strong');
  if (totalListStrong && totalListStrong.length > 0 && totalListStrong.text()) {
    totalListings = parseInt(totalListStrong.text().trim(), 10);
  }

  try {
    const activeLink = $('nav.listing-pagination ul.property-search-pagination-page-numbers li.pge.-num.-active a');
    if (activeLink.length > 0) {
      currentPageNum = parseInt(activeLink.text().trim(), 10);
    } else {
      const firstPageNumLink = $('nav.listing-pagination ul.property-search-pagination-page-numbers li.pge.-num a').first();
      if (firstPageNumLink.length > 0){
          const pageNumText = firstPageNumLink.text().trim();
          if (parseInt(pageNumText, 10) === 1) {
              currentPageNum = 1;
          }
      }
    }

    let nextPageHref;
    const nextButtonLink = $('nav.listing-pagination li.pge.-nav.-reverse a[rel="next"]');
    if (nextButtonLink.length > 0) {
        nextPageHref = nextButtonLink.attr('href');
    } else {
        const currentPageLi = $('nav.listing-pagination ul.property-search-pagination-page-numbers li.pge.-num.-active');
        if (currentPageLi.length > 0) {
            const nextPageLi = currentPageLi.next('li.pge.-num');
            if (nextPageLi.length > 0) {
                const nextPageLinkInNumbers = nextPageLi.find('a');
                if (nextPageLinkInNumbers.length > 0) {
                    nextPageHref = nextPageLinkInNumbers.attr('href');
                }
            }
        }
    }

    if (nextPageHref) {
      const pathPart = nextPageHref.split('?')[0];
      const urlSegments = pathPart.split('/');
      const pageIndicatorSegment = urlSegments.find(segment => /^p\d+$/.test(segment));
      if (pageIndicatorSegment) {
        nextPageNum = parseInt(pageIndicatorSegment.substring(1), 10);
      }
    }
  } catch (error) {
    console.error('Error parsing pagination for rent.com.au:', error);
  }

  const returnJSON = {
    totalListings: totalListings,
    nextPageNum: nextPageNum,
    currentPageNum: currentPageNum,
    listings: []
  };

  $('article.property-cell.-normal').each((index, element) => {
    if ($(element).hasClass('interstitial-ad')) {
        return;
    }

    const address = $(element).find('h2.address').text().trim();
    const imageUrl = $(element).find('img.card-photo').attr('src');
    const priceElement = $(element).find('span.price');
    const propType = priceElement.find('.property-type').text().trim();
    const priceElementClone = priceElement.clone();
    priceElementClone.find('.property-type').remove();
    const price = priceElementClone.text().trim();

    const ldJsonScriptElement = $(element).find('script[type="application/ld+json"]').first();
    const features = [];
    let description = "";
    let url = "";

    $(element).find('ul.features li.feature').each((featIdx, featElement) => {
      const value = $(featElement).find('span.value').text().trim();
      features.push(value);
    });

    if (ldJsonScriptElement.length > 0) {
      let jsonText = ldJsonScriptElement.html();
      jsonText = jsonText.replace(/^\s*\/\/\s*<!\[CDATA\[\s*/, '').replace(/\s*\/\/\s*\]\]>\s*$/, '').trim();
      try {
        const json = JSON.parse(jsonText);
        if (Object.keys(json).length > 0 && json['@type'] === "Residence") {
          description = json.description || "";
          url = json.url || "";
        }
      } catch (e) {
        console.error('Error parsing LD+JSON for a rent.com.au listing. JSON Text:', jsonText, 'Error:', e);
      }
    }

    if (address) {
      const listing = {
        address: address,
        imageUrl: imageUrl,
        price: price,
        features: features,
        propType: propType,
        description: description,
        url: url
      };
      returnJSON.listings.push(listing);
    }
  });

  return returnJSON;
}

function extractFlatmatesListingInfo(obj, n) {
  const listing = obj.listing;
  const url = obj.link;
  const images = obj.allPhotos && Array.isArray(obj.allPhotos) ? obj.allPhotos.slice(0, n).map(photo => photo.desktop) : undefined;
  const price = obj.displayRent;
  const billsIncluded = obj.displayBills && obj.displayBills !== "" ? true : false;
  const bedrooms = listing.number_bedrooms;
  const bathrooms = listing.number_bathrooms;
  const occupants = listing.number_occupants;
  const address = obj.displayAddress;
  const rooms = obj.listingSummary;
  let description = '';
  if (descParam > 0) {
    description = obj.subhead + ' ' + obj.description;
    if (description.length > descParam) {
      description = description.slice(0, descParam);
    }
  }

  return {
    url,
    ...(images && images.length > 0 && { images }),
    price,
    billsIncluded,
    bedrooms,
    bathrooms,
    occupants,
    address,
    rooms,
    ...(description && { description }),
  };
}

function generateFlatmatesURL(baseUrl,locations,bathroomType,furnishings,parking,gender,lengthOfStay,allFemale,lgbtFriendly,retirees,students,smokers,backpackers,children,over40,pets,numberOfRooms,room,dateAvailable,minBudget,maxBudget,billsIncluded,keywordInput,wholeProperties,studios,grannyFlats,studentAccommodation,homestays,shareHouses,page) {
  let url = baseUrl + locations + "/";
  
  if (numberOfRooms > 1) {
    url += numberOfRooms + "-rooms+";
  }
  
  if (allFemale) {
    url += "all-female+";
  }
  
  if (lengthOfStay) {
    url += lengthOfStay.replace(" ", "-") + "+";
  }
  
  if (backpackers) {
    url += "backpackers+";
  }
  
  if (children) {
    url += "children+";
  }
  
  if (lgbtFriendly) {
    url += "lgbt-friendly+";
  }
  
  if (over40) {
    url += "over-40+";
  }
  
  if (pets) {
    url += "pets+";
  }
  
  if (retirees) {
    url += "retirees+";
  }
  
  if (smokers) {
    url += "smokers+";
  }
  
  if (students) {
    url += "students+";
  }
  
  if (billsIncluded) {
    url += "bills-included+";
  }
  
  if (furnishings) {
    url += furnishings + "+";
  }
  
  if (bathroomType) {
    url += bathroomType + "+";
  }
  
  if (keywordInput) {
    url += "keywords-" + keywordInput.replace(" ", "-") + "+";
  }
  
  if (gender) {
    url += gender + "+";
  }
  
  if (parking) {
    url += parking + "+";
  }
  
  if (room) {
    url += room + "+";
  }
  
  if (shareHouses) {
    url += "share-houses+";
  }
  
  if (dateAvailable) {
    url += "available-" + dateAvailable + "+";
  }
  
  if (minBudget){
    url += "min-" + minBudget + "+";
  }
  
  if (maxBudget) {
    url += "max-" + maxBudget + "+";
  }
  
  if (wholeProperties) {
    url += "whole-properties+";
  }
  
  if (studios) {
    url += "studios+";
  }
  
  if (grannyFlats) {
    url += "granny-flats+";
  }
  
  if (studentAccommodation) {
    url += "student-accommodation+";
  }
  
  if (homestays) {
    url += "homestays+";
  }
  
  if (room) {
    url += room + "+";
  }
  if(url.endsWith('+')){
    url.slice(0, -1);
  }
  url += "?page=" + page;
  
  return url;
}

var imgParam = 2;
var descParam = 200;
const app = express();
app.use(cors());
app.use(express.static('public'));

app.use((req, res, next) => {
  const params = new URLSearchParams(req.url.replace('/?',''));
  if(params.get('images')){
    imgParam = parseInt(params.get('images'));
  }
  if(params.get('descriptionLength')){
    descParam = parseInt(params.get('descriptionLength'));
  }
  next();
});

app.use('/rentdc', proxy('https://www.rent.com.au/properties', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    proxyReqOpts.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0";
    proxyReqOpts.headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    proxyReqOpts.headers["Accept-Language"] = "en-US,en;q=0.5";
    proxyReqOpts.headers["Cookie"] = "";
    proxyReqOpts.headers["Referer"] = "https://www.rent.com.au/";
	proxyReqOpts.headers['Alt-Used'] = 'www.rent.com.au';

    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    res.set("Access-Control-Allow-Origin","*");
    res.set("Access-Control-Allow-Methods","*");
    res.set("Access-Control-Allow-Headers","*");
    res.set("Access-Control-Allow-Credentials","true");

    if (proxyRes.statusCode === 200 && proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('text/html')) {
      res.set("content-type", "application/json; charset=utf-8");
      let returnJSON = extractListingDetails(proxyResData.toString('utf8'));
      if (typeof imgParam !== 'undefined' && imgParam === 0) {
          if (returnJSON.listings) {
              returnJSON.listings = returnJSON.listings.map(obj => {
                  delete obj.imageUrl;
                  return obj;
              });
          }
      }

      return JSON.stringify(returnJSON);
    } else {
      if (proxyRes.headers['content-type']) {
        res.set('Content-Type', proxyRes.headers['content-type']);
      }
      res.status(proxyRes.statusCode);
      return proxyResData;
    }
  },
  proxyErrorHandler: function(err, backendRes, next) {
    console.error('Proxy error connecting to rent.com.au:', err);
    if (!backendRes.headersSent) {
        backendRes.status(502).send('Proxy error: Could not connect to the target service.');
    } else {
        if (!backendRes.writableEnded) {
            backendRes.end();
        }
    }
  }
}));

app.use('/test-rentdc-basic', proxy('https://www.rent.com.au', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    proxyReqOpts.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0";
    proxyReqOpts.headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    proxyReqOpts.headers["Accept-Language"] = "en-US,en;q=0.5";
    proxyReqOpts.headers["Accept-Encoding"] = "gzip, deflate, br, zstd";
    proxyReqOpts.headers["Alt-Used"] = "www.rent.com.au";
    proxyReqOpts.headers["cache-control"] = "no-cache";
    proxyReqOpts.headers["pragma"] = "no-cache";
    proxyReqOpts.headers["sec-fetch-dest"] = "document";
    proxyReqOpts.headers["sec-fetch-mode"] = "navigate";
    proxyReqOpts.headers["sec-fetch-site"] = "none";
    proxyReqOpts.headers["sec-fetch-user"] = "?1";
    proxyReqOpts.headers["upgrade-insecure-requests"] = "1";
    proxyReqOpts.headers["Connection"] = "keep-alive";
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    res.status(proxyRes.statusCode);

    return proxyResData;
  },
  proxyErrorHandler: function(err, backendRes, next) {
    console.error('Proxy error connecting to rent.com.au (basic test):', err);
    if (!backendRes.headersSent) {
        backendRes.status(502).send('Proxy error (basic test): Could not connect to the target service.');
    } else {
        if (!backendRes.writableEnded) {
            backendRes.end();
        }
    }
  }
}));

app.use('/scrape-html', proxy(
  (req) => {
    if (!req.query.url) {
      console.error("scrape-html: URL query parameter is missing!");
      return 'http://localhost:1';
    }
    try {
      const targetUrl = new URL(req.query.url);
      return targetUrl.origin;
    } catch (e) {
      console.error("scrape-html: Invalid URL in query parameter:", req.query.url, e);
      return 'http://localhost:1';
    }
  },
  {
    proxyReqPathResolver: (req) => {
      if (!req.query.url) {
        return '/';
      }
      try {
        const targetUrl = new URL(req.query.url);
        return targetUrl.pathname + targetUrl.search;
      } catch (e) {
        return '/';
      }
    },
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36';
      proxyReqOpts.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9';
      proxyReqOpts.headers['Accept-Language'] = 'en-US,en;q=0.9';
      delete proxyReqOpts.headers['cookie'];
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      return proxyResData;
    },
    proxyErrorHandler: (err, res, next) => {
        console.error('Proxy error in /scrape-html:', err);
        if (!res.headersSent) {
            res.status(502).send('Proxy error: Could not fetch the requested URL.');
        } else {
            if (!res.writableEnded) {
                res.end();
            }
        }
    }
  }
));

app.use('/domain', proxy('https://www.domain.com.au/rent', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    if (srcReq.url.indexOf('/?') !== -1 || srcReq.url == '/') {
      srcReq.url = '/rent' + decodeURIComponent(srcReq.url);
      proxyReqOpts.headers["content-type"] = "application/json; charset=utf-8";
      proxyReqOpts.headers["accept"] = "application/json";
    }
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    if (req.url.indexOf('/rent') !== -1) {
      const data = JSON.parse(proxyResData.toString('utf8'));
      if (data.props && data.props.listingsMap) {
        let trimmedData = data.props.listingsMap;
        const numKeys = Object.keys(trimmedData);
        const numObjects = numKeys.length;
          if (numObjects > 50) {
          for (let i = 50; i < numObjects; i++) {
            delete trimmedData[numKeys[i]];
          }
        }
        for (const id in trimmedData) {
         if (trimmedData.hasOwnProperty(id)) {
           delete trimmedData[id].id;
           delete trimmedData[id].listingType;
           delete trimmedData[id].listingModel.skeletonImages;
           delete trimmedData[id].listingModel.auction;
           delete trimmedData[id].listingModel.branding;
           delete trimmedData[id].listingModel.brandingAppearance;
           delete trimmedData[id].listingModel.displaySearchPriceRange;
           delete trimmedData[id].listingModel.enableSingleLineAddress;
           delete trimmedData[id].listingModel.hasVideo;
           delete trimmedData[id].listingModel.promoType;
           delete trimmedData[id].listingModel.tags;
		   if(trimmedData[id].listingModel.address.hasOwnProperty('street') && trimmedData[id].listingModel.address.hasOwnProperty('suburb') && trimmedData[id].listingModel.address.hasOwnProperty('state') && trimmedData[id].listingModel.address.hasOwnProperty('postcode')){
		     trimmedData[id].listingModel.address = `${trimmedData[id].listingModel.address.street}, ${trimmedData[id].listingModel.address.suburb}, ${trimmedData[id].listingModel.address.state} ${trimmedData[id].listingModel.address.postcode}`;
		   }
		   if(trimmedData[id].listingModel.features){
			 if(trimmedData[id].listingModel.features.hasOwnProperty('propertyType')){
		       delete trimmedData[id].listingModel.features.propertyType;
			 }
			 if(trimmedData[id].listingModel.features.hasOwnProperty('isRural')){
		       delete trimmedData[id].listingModel.features.isRural;
			 }
			 if(trimmedData[id].listingModel.features.hasOwnProperty('landSize')){
		       delete trimmedData[id].listingModel.features.landSize;
			 }
			 if(trimmedData[id].listingModel.features.hasOwnProperty('landUnit')){
		       delete trimmedData[id].listingModel.features.landUnit;
			 }
			 if(trimmedData[id].listingModel.features.hasOwnProperty('isRetirement')){
		       delete trimmedData[id].listingModel.features.isRetirement;
			 }
		   }
         }
        }
        if (imgParam) {
          if(imgParam > 0){
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                const images = trimmedData[key].listingModel.images;
                if (Array.isArray(images) && images.length > imgParam) {
                  trimmedData[key].listingModel.images = images.slice(0, imgParam);
                }
              }
            }
          }
          else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].listingModel.images;
              }
            }
          }
        }
        else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].listingModel.images;
              }
            }
        }
        trimmedData = {
          'totalPages': data.props.pageViewMetadata.searchResponse.SearchResults.totalPages,
          'page': data.props.pageViewMetadata.searchResponse.SearchResults.page,
          'totalListings': data.props.pageViewMetadata.searchResponse.SearchResults.totalResults,
          'listingsPerPage': data.props.listingSearchResultIds.length,
          'listings': trimmedData
        };
        return JSON.stringify(trimmedData);
      }
      else{
         return proxyResData;
      }
    }
    else{
       return proxyResData;
    }
  }
}));

app.use('/realestategraph', proxy('https://lexa.realestate.com.au/graphql', {
  proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
    proxyReqOpts.method = 'POST';
    proxyReqOpts.headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/109.0';
    proxyReqOpts.headers['Accept'] = 'application/graphql+json, application/json';
    proxyReqOpts.headers['Content-Type'] = 'application/json';
    proxyReqOpts.headers['Referer'] = 'https://www.realestate.com.au/';

    const queryObject = {
      channel: "rent",
      page: parseInt(srcReq.query.page) || 1,
      pageSize: parseInt(srcReq.query.pageSize) || 25,
      sortType: srcReq.query.sortType || "price-asc",
      filters: {
        "excludeNoSalePrice": false,
        "ex-under-contract": false,
        "ex-deposit-taken": true, // As per request.txt
        "excludeAuctions": false,
        "excludeNoDisplayPrice": false,
        "excludePrivateSales": false,
        "hasScheduledAuction": false,
        // Default to true if not specified or invalid
        surroundingSuburbs: srcReq.query.surroundingSuburbs ? srcReq.query.surroundingSuburbs === 'true' : true, 
        furnished: srcReq.query.furnished === 'true',
        petsAllowed: srcReq.query.petsAllowed === 'true',
      },
      localities: [],
      testListings: false, // As per request.txt for inner query
      recentHides: []      // As per request.txt for inner query
    };

    if (srcReq.query.propertyTypes) {
      queryObject.filters.propertyTypes = srcReq.query.propertyTypes.split(',')
        .map(pt => {
          const trimmedPt = pt.trim().toLowerCase();
          if (trimmedPt === 'unit' || trimmedPt === 'apartment') return 'unit apartment';
          return trimmedPt;
        });
    } else {
      queryObject.filters.propertyTypes = ["house", "townhouse", "unit apartment", "villa"]; // Default from request.txt
    }

    if (srcReq.query.minPrice || srcReq.query.maxPrice) {
      queryObject.filters.priceRange = {};
      if (srcReq.query.minPrice) queryObject.filters.priceRange.minimum = String(srcReq.query.minPrice);
      if (srcReq.query.maxPrice) queryObject.filters.priceRange.maximum = String(srcReq.query.maxPrice);
    }

    if (srcReq.query.minBedrooms || srcReq.query.maxBedrooms) {
      queryObject.filters.bedroomsRange = {};
      if (srcReq.query.minBedrooms) queryObject.filters.bedroomsRange.minimum = String(srcReq.query.minBedrooms);
      if (srcReq.query.maxBedrooms) queryObject.filters.bedroomsRange.maximum = String(srcReq.query.maxBedrooms);
    }
    
    if (srcReq.query.minBathrooms) queryObject.filters.minimumBathroom = String(srcReq.query.minBathrooms);
    if (srcReq.query.minParkingSpaces) queryObject.filters.minimumCars = String(srcReq.query.minParkingSpaces); // Corrected to minParkingSpaces
    
    if (srcReq.query.availableDateMax) queryObject.filters.availableDateRange = { maximum: srcReq.query.availableDateMax };

    if (srcReq.query.keywords) {
      queryObject.filters.keywords = { terms: srcReq.query.keywords.split(',').map(k => k.trim()) };
    }
    
    if (srcReq.query.locations) {
      queryObject.localities = srcReq.query.locations.split(';')
        .map(loc => ({ searchLocation: loc.trim() }));
    } else {
        // API requires localities. If not provided, it's an issue.
        // For now, this will result in an empty localities array.
        // Client should ensure locations are provided.
    }

    const graphJsonPayload = {
      operationName: "searchByQuery",
      variables: {
        query: JSON.stringify(queryObject),
        testListings: false, // Outer variable as per request.txt
        recentHides: []      // Outer variable as per request.txt
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: "85827545576eeee7a1c63949dfb515c1dea0eb03fd77d269292e6525cdcfeee0"
        }
      }
    };
    
    proxyReqOpts.body = JSON.stringify(graphJsonPayload);
    delete proxyReqOpts.query; // remove query params from proxied request
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, userReq, userRes) {
    userRes.set("Access-Control-Allow-Origin","*");
    userRes.set("Access-Control-Allow-Methods","*"); // Typically GET, POST for GraphQL
    userRes.set("Access-Control-Allow-Headers","*");
    userRes.set("Access-Control-Allow-Credentials","true");

    if (proxyRes.statusCode === 200) {
      userRes.set("content-type", "application/json; charset=utf-8");
      const originalData = JSON.parse(proxyResData.toString('utf8'));
      
      if (originalData.errors) {
        console.error("GraphQL API returned errors:", JSON.stringify(originalData.errors));
        // Return the errors to the client
        return JSON.stringify({ errors: originalData.errors });
      }

      if (!originalData.data || !originalData.data.rentSearch || !originalData.data.rentSearch.results) {
        console.warn("Unexpected response structure from GraphQL API:", originalData);
        return JSON.stringify({ error: "Unexpected response structure from upstream API.", data: originalData });
      }

      const results = originalData.data.rentSearch.results;
      const pagination = results.pagination || {};
      
      let allListings = [];
      if (results.exact && Array.isArray(results.exact.items)) {
        allListings = allListings.concat(results.exact.items);
      }
      if (results.surrounding && Array.isArray(results.surrounding.items)) {
        allListings = allListings.concat(results.surrounding.items);
      }

      const transformedListings = allListings.map(item => {
        const listing = item.listing || {};
        let limitedImages = [];
        if (imgParam > 0 && listing.media && Array.isArray(listing.media.images)) {
            limitedImages = listing.media.images.slice(0, imgParam).map(img => img.templatedUrl);
        }

        return {
          id: listing.id,
          url: listing._links?.canonical?.href,
          price: listing.price?.display,
          address: listing.address ? {
            full: listing.address.display?.fullAddress,
            short: listing.address.display?.shortAddress,
            suburb: listing.address.suburb,
            postcode: listing.address.postcode,
            state: listing.address.state,
          } : undefined,
          bedrooms: listing.generalFeatures?.bedrooms?.value,
          bathrooms: listing.generalFeatures?.bathrooms?.value,
          parkingSpaces: listing.generalFeatures?.parkingSpaces?.value,
          studies: listing.generalFeatures?.studies?.value,
          propertyType: listing.propertyType?.display,
          propertyTypeId: listing.propertyType?.id,
          description: (descParam > 0 && listing.description) ? listing.description.slice(0, descParam) : ((listing.description && descParam !==0) ? listing.description : undefined),
          mainImage: (imgParam > 0 && listing.media?.mainImage?.templatedUrl) ? listing.media.mainImage.templatedUrl : undefined,
          images: (imgParam > 0) ? limitedImages : undefined,
          agencyName: listing.listingCompany?.name,
          agencyId: listing.listingCompany?.id,
          agencyLogo: listing.listingCompany?.media?.logo?.templatedUrl,
          listers: listing.listers?.map(l => ({
              name: l.name,
              phone: l.phoneNumber?.display,
              photo: l.photo?.templatedUrl
          })),
          availableDate: listing.availableDate?.display,
          bond: listing.bond?.display,
          inspections: listing.inspections?.map(insp => ({
            startTime: insp.startTime,
            endTime: insp.endTime,
            label: insp.display?.longLabel || insp.display?.shortLabel
          })),
          productDepth: listing.productDepth
        };
      });

      const responseJson = {
        totalListings: results.totalResultsCount || 0,
        currentPage: pagination.page || 1,
        pageSize: parseInt(userReq.query.pageSize) || 25, // Echo back requested pageSize
        totalPages: pagination.maxPageNumberAvailable || 0,
        listings: transformedListings
      };
      return JSON.stringify(responseJson);
    } else {
      if (proxyRes.headers['content-type']) {
        userRes.set('Content-Type', proxyRes.headers['content-type']);
      }
      userRes.status(proxyRes.statusCode);
      return proxyResData;
    }
  },
  proxyErrorHandler: function(err, backendRes, next) {
    console.error('Proxy error connecting to GraphQL realestate.com.au:', err);
    if (!backendRes.headersSent) {
        backendRes.status(502).send('Proxy error: Could not connect to the target GraphQL service.');
    } else {
        if (!backendRes.writableEnded) {
            backendRes.end();
        }
    }
  }
}));

app.use('/realestate', proxy('https://services.realestate.com.au/services/listings/search', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    if (srcReq.url.indexOf('/?') !== -1) {
      const params = extractUrlParameters(srcReq.url.replace('/?',''));
      const paramObject = constructObject(
        params.channel,
        params.searchLocation,
        params.pageSize,
        params.page,
        params.propertyType,
        params.minimumPrice,
        params.maximumPrice,
		params.minBedrooms,
		params.minBathrooms,
		params.minParkingSpaces,
        params.surroundingSuburbs,
		params.furnished,
		params.petsAllowed,
		getfeaturesList({swimmingPool: params.swimmingPool, garage: params.garage, balcony: params.balcony, outdoorArea: params.outdoorArea, ensuite: params.ensuite, dishwasher: params.dishwasher, study: params.study, builtInRobes: params.builtInRobes, airConditioning: params.airConditioning, solarPanels: params.solarPanels, heating: params.heating, highEnergyEfficiency: params.highEnergyEfficiency, waterTank: params.waterTank, solarHotWater: params.solarHotWater})
      );
      srcReq.url = '/services/listings/search?query=' + JSON.stringify(paramObject);
    }
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    if (req.url.indexOf('?query=') !== -1) {
      const data = JSON.parse(proxyResData.toString('utf8'));
      if (data.tieredResults) {
        let trimmedData = data.tieredResults[0].results;
        let returnJSON = {
          totalListings: data.totalResultsCount,
          currentPage: data.resolvedQuery.page,
          pageSize: data.resolvedQuery.pageSize,
          listings: null
        };
        for (const id in trimmedData) {
         if (trimmedData.hasOwnProperty(id)) {
           delete trimmedData[id].standard;
           delete trimmedData[id].midtier;
           delete trimmedData[id].lister;
           delete trimmedData[id].featured;
           delete trimmedData[id]['_links'];
           delete trimmedData[id].signature;
           delete trimmedData[id].channel;
           delete trimmedData[id].advertising;
           delete trimmedData[id].showAgencyLogo;
           delete trimmedData[id].listers;
           delete trimmedData[id].productDepth;
           delete trimmedData[id].calculator;
           delete trimmedData[id].address.subdivisionCode;
           delete trimmedData[id].address.showAddress;
           delete trimmedData[id].address.locality;
           delete trimmedData[id].agency;
           delete trimmedData[id].isSoldChannel;
           delete trimmedData[id].isBuyChannel;
           delete trimmedData[id].signatureProject;
           delete trimmedData[id].listingId;
           delete trimmedData[id].classicProject;
           delete trimmedData[id].agencyListingId;
           delete trimmedData[id].mainImage;
           delete trimmedData[id].dateAvailable.dateDisplay;
           delete trimmedData[id].modifiedDate;
           delete trimmedData[id].isRentChannel;
           delete trimmedData[id].applyOnline;
           delete trimmedData[id].status;
           delete trimmedData[id].features;
           delete trimmedData[id].title;
		   delete trimmedData[id].inspectionsAndAuctions;
		   try{
             if (trimmedData[id].hasOwnProperty('propertyFeatures')) {
               trimmedData[id].propertyFeatures.forEach((feature) => {
                 delete feature.section;
                 delete feature.label;
               });
			   trimmedData[id].propertyFeatures = trimmedData[id].propertyFeatures.map((feature) => feature.features).flat();
		     }
             if (trimmedData[id].hasOwnProperty('bond') && trimmedData[id].bond.hasOwnProperty('display')) {
               trimmedData[id].bond = trimmedData[id].bond.display;
		     }
             if (trimmedData[id].hasOwnProperty('generalFeatures')) {
			   if (!trimmedData[id].propertyFeatures) {
                 trimmedData[id].propertyFeatures = [];
               }
			   trimmedData[id].propertyFeatures = trimmedData[id].propertyFeatures.concat(Object.values(trimmedData[id].generalFeatures).map((feature) => feature.label));
			   delete trimmedData[id].generalFeatures;
		     }
			 if (trimmedData[id].hasOwnProperty('dateAvailable') && trimmedData[id].dateAvailable.hasOwnProperty('date')) {
               trimmedData[id].dateAvailable = trimmedData[id].dateAvailable.date;
             }
			 if (trimmedData[id].nextInspectionTime && trimmedData[id].nextInspectionTime.startTimeDisplay && trimmedData[id].nextInspectionTime.endTimeDisplay) {
			   const { startTime, endTime } = trimmedData[id].nextInspectionTime;
               trimmedData[id].nextInspectionTime = { startTime, endTime };
             }
             if (trimmedData[id].hasOwnProperty('price')) {
			   if(trimmedData[id].price.hasOwnProperty('display')){
                 trimmedData[id].price = trimmedData[id].price.display;
			   }
			   trimmedData[id].price = trimmedData[id].price.replace('per week','pw')
			   if(trimmedData[id].price.indexOf('$') == -1){
				   delete trimmedData[id].price;
			   }
		     }
			 trimmedData[id].address = `${trimmedData[id].address.streetAddress}, ${trimmedData[id].address.suburb}, ${trimmedData[id].address.state} ${trimmedData[id].address.postcode || trimmedData[id].address.postCode}`;
		   }
		   catch(e){
		   }
         }
        }
        if (descParam) {
          if(descParam > 0){
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
				trimmedData[key].description = trimmedData[key].description.slice(0, descParam);
			  }
            }
          }
          else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].description;
              }
            }
          }
        }
        else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].description;
              }
            }
        }
        if (imgParam) {
          if(imgParam > 0){
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                const images = trimmedData[key].images;
                if (Array.isArray(images) && images.length > imgParam) {
                  trimmedData[key].images = images.slice(0, imgParam);
				  let newimages = [];
                  for (let imgKey in trimmedData[key].images) {
                    if (trimmedData[key].images.hasOwnProperty(imgKey)) {
					  if(trimmedData[key].images[imgKey].uri){
                        newimages.push(trimmedData[key].images[imgKey].server + trimmedData[key].images[imgKey].uri);
					  }
                    }
                  }
				  trimmedData[key].images = newimages;
                }
			  }
            }
          }
          else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].images;
              }
            }
          }
        }
        else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].images;
              }
            }
        }
        returnJSON.listings = trimmedData;
        return JSON.stringify(returnJSON);
      }
      else{
         return proxyResData;
      }
    }
    else{
       return proxyResData;
    }
  }
}));

app.use('/flatmates', proxy('https://flatmates.com.au', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    proxyReqOpts.headers["Accept"] = "application/json";
    proxyReqOpts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    proxyReqOpts.headers["Origin"] = "https://flatmates.com.au";
    proxyReqOpts.headers["Referer"] = "https://flatmates.com.au";
    proxyReqOpts.method = 'GET';
    const params = extractUrlParameters(srcReq.url.replace('/?',''));
    const flatmatesURL = generateFlatmatesURL(
	  'https://flatmates.com.au/rooms/',
      params.locations,
	  params.bathroomType,
	  params.furnishings,
	  params.parking,
	  params.gender,
	  params.lengthOfStay,
	  params.allFemale,
	  params.lgbtFriendly,
	  params.retirees,
	  params.students,
	  params.smokers,
	  params.backpackers,
	  params.children,
	  params.over40,
	  params.pets,
	  params.numberOfRooms,
	  params.room,
	  params.dateAvailable,
	  params.minBudget,
	  params.maxBudget,
	  params.billsIncluded,
	  params.keywordInput,
	  params.wholeProperties,
	  params.studios,
	  params.grannyFlats,
	  params.studentAccommodation,
	  params.homestays,
	  params.shareHouses,
	  params.page
	);
	srcReq.url = flatmatesURL;
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    const data = JSON.parse(proxyResData.toString("utf8"));
    if (data.listings) {
      let trimmedData = {
        nextPage: data.nextPage,
        listings: []
      };
	  for (const id in data.listings) {
		let listingInfo = extractFlatmatesListingInfo(data.listings[id], imgParam);
        trimmedData.listings.push(listingInfo);
	  }
      return JSON.stringify(trimmedData);
    }
	else {
      return proxyResData;
    }
  }
}));

const server = app.listen(443);