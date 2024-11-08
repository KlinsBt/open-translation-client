<script>
	import logo from "$lib/images/logo.png";
	import facebookIcon from "$lib/images/logo.png";
	import twitterIcon from "$lib/images/logo.png";
	import instagramIcon from "$lib/images/logo.png";
	import github from "$lib/images/github.svg";
</script>

<footer>
	<div class="footer-container">
		<!-- <div class="footer-logo">
			<img src={logo} alt="Open Translation Client" />
			<p>Open TLC</p>
		</div> -->
		<div class="footer-social">
			<a
				href="https://github.com/KlinsBt/open-translation-client"
				aria-label="Github"
			>
				<img src={github} alt="Github" />
				<p>Github</p>
			</a>
		</div>
	</div>
</footer>

<style>
	footer {
		background-color: var(--color-theme-5);
		background-color: var(--color-theme-10);
		padding: 1rem 0rem;
		color: white;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.footer-container {
		display: flex;
		justify-content: center;
		align-items: center;
		flex-direction: column;
		flex-wrap: wrap;
		width: 100%;
		max-width: 1200px;
		padding: 0 1rem;
	}

	/* .footer-logo {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin: 0px 0px 2rem 0px;
		text-align: center;
	}

	.footer-logo > img {
		width: 50px;
		height: auto;
		margin-bottom: 4px;
	}

	.footer-logo > p {
		font-size: 1rem;
		font-weight: 700;
		margin: 0px;
		color: var(--color-theme-7);
	} */

	.footer-social {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 0.5rem;
	}

	.footer-social > a {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-decoration: none;
	}

	.footer-social > a > p {
		color: var(--color-theme-2);
		color: #fff;
		margin: 0px;
		transition: all 0.2s linear;
	}

	.footer-social > a > img {
		width: 50px;
		height: 50px;
		transition: all 0.2s linear;
	}

	.footer-social:hover > a > img,
	.footer-social:hover > a > p {
		opacity: 0.8;
	}
</style>
