Rails.application.routes.draw do
  resources :sources do
    collection do
      post "/switch-to", to: "sources#switch_to"      
    end
  end

  root to: "home#index"
end
