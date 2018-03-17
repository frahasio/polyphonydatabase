module Admin
  class GroupsController < ApplicationController
    def index
      groups = Group.distinct.order(:display_title)
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
      if params[:groups].blank?
        flash[:error] = "You have to select groups to merge"
        redirect_to admin_groups_path(request.query_parameters)
        return
      end

      groups = Group.find(params[:groups])

      compositions = groups.flat_map(&:compositions)
      editions = groups.flat_map(&:editions)
      recordings = groups.flat_map(&:recordings)

      new_group = groups.shift

      new_group.display_title = params[:display_title] unless params[:display_title].blank?
      new_group.update!(
        compositions: compositions,
        editions: editions,
        recordings: recordings,
      )

      groups.each(&:destroy)

      redirect_to admin_groups_path(request.query_parameters)
    end

    def confirm_remove
      @group = Group.find(params[:id])
      @composition = Composition.find(params[:composition_id])
    end

    def remove
      composition = Composition.find(params[:composition_id])
      composition.update(
        group: Group.create!(display_title: composition.title.text)
      )

      redirect_to admin_groups_path(request.query_parameters.except(:composition_id))
    end
  end
end
