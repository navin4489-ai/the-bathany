using Eshopper.Api.Services;
using Microsoft.AspNetCore.Mvc;
namespace Eshopper.Api.Controllers;

[ApiController, Route("api/payments")]
public class PaymentsController(IPaymentGateway gateway) : ControllerBase
{
    /// <summary>Payment methods and test cards supported by the simulated gateway.</summary>
    [HttpGet("methods")]
    public IActionResult Methods() => Ok(new { provider = "The Bathany Secure Pay", sandbox = true, methods = gateway.Methods, testCards = gateway.TestCards });
}
