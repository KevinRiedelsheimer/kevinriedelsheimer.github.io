const getSeriesPosts = (data) => {
	const seriesKey = data.series?.key;
	const posts = data.collections?.posts;

	if (!seriesKey || !Array.isArray(posts)) {
		return [];
	}

	return posts
		.filter((post) => post.data?.series?.key === seriesKey)
		.slice()
		.sort((left, right) => {
			const leftPart = left.data?.series?.part ?? Number.MAX_SAFE_INTEGER;
			const rightPart = right.data?.series?.part ?? Number.MAX_SAFE_INTEGER;

			if (leftPart !== rightPart) {
				return leftPart - rightPart;
			}

			return left.url.localeCompare(right.url);
		})
		.map((post) => ({
			url: post.url,
			title: post.data?.series?.label || post.data?.title,
			fullTitle: post.data?.title,
			description: post.data?.description,
			part: post.data?.series?.part,
			isCurrent: post.url === data.page.url,
		}));
};

const getSeriesSibling = (data, offset) => {
	const seriesPosts = getSeriesPosts(data);
	const currentIndex = seriesPosts.findIndex((post) => post.isCurrent);

	if (currentIndex === -1) {
		return null;
	}

	return seriesPosts[currentIndex + offset] || null;
};

export default {
	tags: [
		"posts"
	],
	eleventyImport: {
		collections: ["posts"]
	},
	eleventyComputed: {
		seriesPosts: (data) => getSeriesPosts(data),
		seriesPrevious: (data) => getSeriesSibling(data, -1),
		seriesNext: (data) => getSeriesSibling(data, 1),
	},
	"layout": "layouts/post.njk",
	"permalink": "/blog/posts/{{ date | dateToSlashSeparatedYMD }}/{{ title | slugify }}/"
};
