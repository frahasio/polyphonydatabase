module Admin
  class GroupsController < ApplicationController
    def index
      groups = Group.distinct(:id).order(:display_title)
      groups = GroupFilter.new(params).filter(groups)
      groups = groups.includes(
        compositions: [
          :composers,
          inclusions: [
            :source,
          ],
        ],
      )

      @groups = groups.limit(200)
    end

    def merge
      redirect_to admin_groups_path
    end
  end
end
