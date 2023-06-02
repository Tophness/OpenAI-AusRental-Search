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

function constructObject(channel, subdivision, postcode, pageSize, page, propertyType, minimumPrice, maximumPrice, surroundingSuburbs, replaceProjectWithFirstChild) {
  const obj = {
    channel: channel,
    localities: [
      {
        subdivision: subdivision,
        postcode: postcode
      }
    ],
    pageSize: pageSize,
    page: page,
    filters: {
      propertyTypes: [propertyType],
      priceRange: {
        minimum: minimumPrice,
        maximum: maximumPrice
      },
      surroundingSuburbs: surroundingSuburbs,
      replaceProjectWithFirstChild: replaceProjectWithFirstChild
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
          'totalResults': data.props.pageViewMetadata.searchResponse.SearchResults.totalResults,
          'resultsPerPage': data.props.listingSearchResultIds.length,
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
        params.subdivision,
        params.postcode,
        params.pageSize,
        params.page,
        params.propertyType,
        params.minimumPrice,
        params.maximumPrice,
        params.surroundingSuburbs,
        params.replaceProjectWithFirstChild
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
           trimmedData[id].price = trimmedData[id].price.display;
           trimmedData[id].propertyFeatures.forEach((feature) => {
             delete feature.section;
             delete feature.label;
           });
           trimmedData[id].bond = trimmedData[id].bond.display;
           if (trimmedData[id].inspectionsAndAuctions.length === 0) {
             delete trimmedData[id].inspectionsAndAuctions;
           }
           trimmedData[id].generalFeatures = Object.values(trimmedData[id].generalFeatures).map((feature) => feature.label);
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

const server = app.listen(443);