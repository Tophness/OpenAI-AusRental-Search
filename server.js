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
  let nextPageNum = 2;
  let currentPageNum = 1;
  let totalListings = 0;
  const totalList = $('div.listings h1.text-heading strong');
  if(totalList && totalList.text()){
    totalListings = parseInt(totalList.text());
  }
  try {
    const activeLink = $('.pge a.-active');
    if (activeLink.length > 0) {
      currentPageNum = parseInt(activeLink.text().trim());
    }
    const lastPageElement = $('.listings .ui-pagination li.pge:last-child');
    const nextPageLink = lastPageElement.find('a[rel="next"]');
    if (nextPageLink.length !== 0) {
      const parts = nextPageLink.attr('href').split('/');
      const lastPart = parts[parts.length - 1];
      nextPageNum = parseInt(lastPart.replace('p', ''));
    }
  } catch (error) {}

  const returnJSON = {
    totalListings: totalListings,
    nextPageNum: nextPageNum,
    currentPageNum: currentPageNum,
    listings: []
  };

  $('article.property-cell').each((index, element) => {
    const address = $(element).find('h2.address').text().trim();
    const imageUrl = $(element).find('img.card-photo').attr('src');
    const priceElement = $(element).find('span.price');
    const propType = $(priceElement).find('.property-type').text().trim();
    priceElement.find('.property-type').remove();
    const price = priceElement.text().trim();
    const ldJsonScripts = $(element).find('script[type="application/ld+json"]').first();
    const features = [];
    let description = "";
    let url = "";

    $(element).find('ul.features li.feature').each((index, element) => {
      const value = $(element).find('span.value').text().trim();
      features.push(value);
    });

    if (ldJsonScripts.length > 0) {
      let jsonText = ldJsonScripts.html();
      jsonText = jsonText.replace('//<![CDATA[', '').replace('//]]>', '');
      try {
        const json = JSON.parse(jsonText);
        const isEmpty = Object.keys(json).length === 0;

        if (!isEmpty && json['@type'] !== "RentAction") {
          description = json.description;
          url = json.url;
        }
      } catch (error) {
        console.error('Error parsing JSON:', error);
      }
    }

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

function generateFlatmatesURL(baseUrl,locations,bathroomType,furnishings,parking,gender,lengthOfStay,allFemale,lgbtFriendly,retirees,students,smokers,backpackers,children,over40,pets,numberOfRooms,room,dateAvailable,minBudget,maxBudget,billsIncluded,keywordInput,wholeProperties,studios,oneBeds,grannyFlats,studentAccommodation,homestays,shareHouses) {
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
  
  if (oneBeds) {
    url += "one-beds+";
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
  url += "?search_source=search_function";
  
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
    srcReq.url = '/properties' + srcReq.url;
    proxyReqOpts.headers["Accept"] = "text/html";
    proxyReqOpts.headers["Cookie"] = "";
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    res.set("Access-Control-Allow-Origin","*");
    res.set("Access-Control-Allow-Methods","*");
    res.set("Access-Control-Allow-Headers","*");
    res.set("Access-Control-Allow-Credentials","true");
    if (req.url.indexOf('/properties') !== -1) {
      res.set("content-type", "application/json; charset=utf-8");
      res.set("accept", "application/json");
      let returnJSON = extractListingDetails(proxyResData);
      if (imgParam && imgParam !== 0) {
        returnJSON.listings = returnJSON.listings.map(obj => {
          delete obj.imageUrl;
          return obj;
        });
      }
      return JSON.stringify(returnJSON);
    } else {
      return proxyResData;
    }
  }
}));

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
		   if(trimmedData[id].listingModel.address.street && trimmedData[id].listingModel.address.suburb && trimmedData[id].listingModel.address.state && trimmedData[id].listingModel.address.postcode){
		     trimmedData[id].listingModel.address = `${trimmedData[id].listingModel.address.street}, ${trimmedData[id].listingModel.address.suburb}, ${trimmedData[id].listingModel.address.state} ${trimmedData[id].listingModel.address.postcode}`;
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
    proxyReqOpts.method = 'POST';
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
	  params.oneBeds,
	  params.grannyFlats,
	  params.studentAccommodation,
	  params.homestays,
	  params.shareHouses
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