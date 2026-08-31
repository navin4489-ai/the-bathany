USE Eshopper;
IF NOT EXISTS (SELECT 1 FROM Roles WHERE Name='Customer') INSERT Roles(Name) VALUES ('Customer');
IF NOT EXISTS (SELECT 1 FROM Roles WHERE Name='Admin') INSERT Roles(Name) VALUES ('Admin');
IF NOT EXISTS (SELECT 1 FROM Categories WHERE Name='Clothing') INSERT Categories(Name) VALUES ('Clothing');
IF NOT EXISTS (SELECT 1 FROM Categories WHERE Name='Shoes') INSERT Categories(Name) VALUES ('Shoes');
IF NOT EXISTS (SELECT 1 FROM Users WHERE Email='admin@eshopper.local')
 INSERT Users(Email,DisplayName,PasswordHash,Role) VALUES ('admin@eshopper.local','Store Admin','pbkdf2-sha256$120000$AAAAAAAAAAAAAAAAAAAAAA==$KQdNrPs2brStCe7bXaOOhq6I5p+Wlm/b7wfe2suyJwY=','Admin');
IF NOT EXISTS (SELECT 1 FROM Products WHERE Name='Premium T-Shirt')
 INSERT Products(Name,Description,Price,Stock,ImageUrl,CategoryId) SELECT 'Premium T-Shirt','Soft cotton everyday wear',24.99,100,'/img/product-1.jpg',Id FROM Categories WHERE Name='Clothing';
