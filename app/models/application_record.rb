class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true

  def self.search(query)
    where("search_vector @@ websearch_to_tsquery('english', :query)", query: query)
  end
end
