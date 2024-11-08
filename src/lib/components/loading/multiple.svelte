<!-- GRADIENT SPINNER -->
<div class="spinner-box">
	<div class="circle-border">
		<div class="circle-core"></div>
	</div>
</div>

<!-- SPINNER ORBITS -->
<div class="spinner-box">
	<div class="blue-orbit leo"></div>

	<div class="green-orbit leo"></div>

	<div class="red-orbit leo"></div>

	<div class="white-orbit w1 leo"></div>
	<div class="white-orbit w2 leo"></div>
	<div class="white-orbit w3 leo"></div>
</div>

<!-- GRADIENT CIRCLE PLANES -->
<div class="spinner-box">
	<div class="leo-border-1">
		<div class="leo-core-1"></div>
	</div>
	<div class="leo-border-2">
		<div class="leo-core-2"></div>
	</div>
</div>

<!-- SPINNING SQUARES -->
<div class="spinner-box">
	<div class="configure-border-1">
		<div class="configure-core"></div>
	</div>
	<div class="configure-border-2">
		<div class="configure-core"></div>
	</div>
</div>

<!-- SOLAR SYSTEM -->
<div class="spinner-box">
	<div class="solar-system">
		<div class="earth-orbit orbit">
			<div class="planet earth"></div>
			<div class="venus-orbit orbit">
				<div class="planet venus"></div>
				<div class="mercury-orbit orbit">
					<div class="planet mercury"></div>
					<div class="sun"></div>
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Three Quarter Spinner -->

<div class="spinner-box">
	<div class="three-quarter-spinner"></div>
</div>

<style>
	/* KEYFRAMES */

	@keyframes spin {
		from {
			transform: rotate(0);
		}
		to {
			transform: rotate(359deg);
		}
	}

	@keyframes spin3D {
		from {
			transform: rotate3d(0.5, 0.5, 0.5, 360deg);
		}
		to {
			transform: rotate3d(0deg);
		}
	}

	@keyframes configure-clockwise {
		0% {
			transform: rotate(0);
		}
		25% {
			transform: rotate(90deg);
		}
		50% {
			transform: rotate(180deg);
		}
		75% {
			transform: rotate(270deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes configure-xclockwise {
		0% {
			transform: rotate(45deg);
		}
		25% {
			transform: rotate(-45deg);
		}
		50% {
			transform: rotate(-135deg);
		}
		75% {
			transform: rotate(-225deg);
		}
		100% {
			transform: rotate(-315deg);
		}
	}

	/* GRID STYLING */

	.spinner-box {
		width: 300px;
		height: 300px;
		display: flex;
		justify-content: center;
		align-items: center;
		background-color: transparent;
	}

	/* SPINNING CIRCLE */

	.leo-border-1 {
		position: absolute;
		width: 150px;
		height: 150px;
		padding: 3px;
		display: flex;
		justify-content: center;
		align-items: center;
		border-radius: 50%;
		background: rgb(63, 249, 220);
		background: linear-gradient(
			0deg,
			rgba(63, 249, 220, 0.1) 33%,
			rgba(63, 249, 220, 1) 100%
		);
		animation: spin3D 1.8s linear 0s infinite;
	}

	.leo-core-1 {
		width: 100%;
		height: 100%;
		background-color: #37474faa;
		border-radius: 50%;
	}

	.leo-border-2 {
		position: absolute;
		width: 150px;
		height: 150px;
		padding: 3px;
		display: flex;
		justify-content: center;
		align-items: center;
		border-radius: 50%;
		background: rgb(251, 91, 83);
		background: linear-gradient(
			0deg,
			rgba(251, 91, 83, 0.1) 33%,
			rgba(251, 91, 83, 1) 100%
		);
		animation: spin3D 2.2s linear 0s infinite;
	}

	.leo-core-2 {
		width: 100%;
		height: 100%;
		background-color: #1d2630aa;
		border-radius: 50%;
	}

	/* ALTERNATING ORBITS */

	.circle-border {
		width: 150px;
		height: 150px;
		padding: 3px;
		display: flex;
		justify-content: center;
		align-items: center;
		border-radius: 50%;
		background: rgb(63, 249, 220);
		background: linear-gradient(
			0deg,
			rgba(63, 249, 220, 0.1) 33%,
			rgba(63, 249, 220, 1) 100%
		);
		animation: spin 0.8s linear 0s infinite;
	}

	.circle-core {
		width: 100%;
		height: 100%;
		background-color: #1d2630;
		border-radius: 50%;
	}

	/* X-ROTATING BOXES */

	.configure-border-1 {
		width: 115px;
		height: 115px;
		padding: 3px;
		position: absolute;
		display: flex;
		justify-content: center;
		align-items: center;
		background: #fb5b53;
		animation: configure-clockwise 3s ease-in-out 0s infinite alternate;
	}

	.configure-border-2 {
		width: 115px;
		height: 115px;
		padding: 3px;
		left: -115px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: rgb(63, 249, 220);
		transform: rotate(45deg);
		animation: configure-xclockwise 3s ease-in-out 0s infinite alternate;
	}

	.configure-core {
		width: 100%;
		height: 100%;
		background-color: #1d2630;
	}

	/* SOLAR SYSTEM */

	.solar-system {
		width: 250px;
		height: 250px;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.orbit {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		border: 1px solid #fafbfc;
		border-radius: 50%;
	}

	.earth-orbit {
		width: 165px;
		height: 165px;
		-webkit-animation: spin 12s linear 0s infinite;
		animation: spin 12s linear 0s infinite;
	}

	.venus-orbit {
		width: 120px;
		height: 120px;
		-webkit-animation: spin 7.4s linear 0s infinite;
		animation: spin 7.4s linear 0s infinite;
	}

	.mercury-orbit {
		width: 90px;
		height: 90px;
		-webkit-animation: spin 3s linear 0s infinite;
		animation: spin 3s linear 0s infinite;
	}

	.planet {
		position: absolute;
		top: -5px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background-color: #3ff9dc;
	}

	.sun {
		width: 35px;
		height: 35px;
		border-radius: 50%;
		background-color: #ffab91;
	}

	.leo {
		position: absolute;
		display: flex;
		justify-content: center;
		align-items: center;
		border-radius: 50%;
	}

	.blue-orbit {
		width: 165px;
		height: 165px;
		border: 1px solid #91daffa5;
		-webkit-animation: spin3D 3s linear 0.2s infinite;
		animation: spin3D 3s linear 0.2s infinite;
	}

	.green-orbit {
		width: 120px;
		height: 120px;
		border: 1px solid #91ffbfa5;
		-webkit-animation: spin3D 2s linear 0s infinite;
		animation: spin3D 2s linear 0s infinite;
	}

	.red-orbit {
		width: 90px;
		height: 90px;
		border: 1px solid #ffca91a5;
		-webkit-animation: spin3D 1s linear 0s infinite;
		animation: spin3D 1s linear 0s infinite;
	}

	.white-orbit {
		width: 60px;
		height: 60px;
		border: 2px solid #ffffff;
		-webkit-animation: spin3D 10s linear 0s infinite;
		animation: spin3D 10s linear 0s infinite;
	}

	.w1 {
		transform: rotate3D(1, 1, 1, 90deg);
	}

	.w2 {
		transform: rotate3D(1, 2, 0.5, 90deg);
	}

	.w3 {
		transform: rotate3D(0.5, 1, 2, 90deg);
	}

	.three-quarter-spinner {
		width: 50px;
		height: 50px;
		border: 3px solid #fb5b53;
		border-top: 3px solid transparent;
		border-radius: 50%;
		animation: spin 0.5s linear 0s infinite;
	}
</style>
